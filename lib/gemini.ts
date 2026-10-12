/** Gemini Flash only. Base URL and model come from env, never hard-coded. Retries 429/5xx with backoff. */

export class Budget {
  used = 0;
  constructor(public readonly max: number) {}
  get left() {
    return this.max - this.used;
  }
  take(n = 1): boolean {
    if (this.used + n > this.max) return false;
    this.used += n;
    return true;
  }
}

export class GeminiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** Hard stop for the whole run: no Gemini call starts, retries or waits past this moment (set by the run guard). */
let runDeadline = Infinity;
export const setGeminiDeadline = (ms: number) => { runDeadline = ms; };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface GeminiRequest {
  prompt: string;
  system?: string;
  schema?: object; // OpenAPI-style schema (uppercase types)
  temperature?: number;
  grounding?: boolean;
  seed?: number;
}

export function geminiConfig() {
  const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const key = process.env.GEMINI_API_KEY;
  const primary = process.env.GEMINI_MODEL;
  if (!primary) throw new GeminiError("GEMINI_MODEL not set");
  if (!key) throw new GeminiError("GEMINI_API_KEY not set");
  // Optional fallbacks (comma separated Flash model ids), used when a model's daily quota is used up or it stays overloaded.
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter((m) => m && m !== primary);
  return { base, key, models: [primary, ...fallbacks] };
}

// models whose daily quota is spent: skipped for an hour (per server instance)
const exhaustedUntil = new Map<string, number>();
export const resetExhausted = () => exhaustedUntil.clear();
// per-minute and per-day limits share the metric name, so only the "PerDay" quota id means "done for today"
const isDailyQuota = (j: any) => /PerDay/i.test(JSON.stringify(j?.error ?? {}));
/** Seconds Google asks us to wait (RetryInfo detail, or "Please retry in 14.4s" in the message). */
export function retryAfterSeconds(j: any): number | null {
  const d = (j?.error?.details ?? []).find((x: any) => typeof x?.retryDelay === "string")?.retryDelay;
  const m = String(d ?? j?.error?.message ?? "").match(/(?:retry in\s+)?(\d+(?:\.\d+)?)\s*s\b/i);
  return m ? Number(m[1]) : null;
}

export async function geminiRaw(req: GeminiRequest, opts: { retries?: number; baseDelayMs?: number; timeoutMs?: number } = {}): Promise<any> {
  const { base, key, models } = geminiConfig();
  const retries = opts.retries ?? Number(process.env.GEMINI_RETRIES ?? 5);
  const delay = opts.baseDelayMs ?? 2000;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: { temperature: req.temperature ?? 0 },
  };
  if (req.seed !== undefined) body.generationConfig.seed = req.seed;
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (req.schema) {
    body.generationConfig.responseMimeType = "application/json";
    body.generationConfig.responseSchema = req.schema;
  }
  if (req.grounding) body.tools = [{ google_search: {} }];
  // Reading an article does not need long reasoning; low thinking is several times faster. Env-overridable.
  const thinking = process.env.GEMINI_THINKING_LEVEL ?? "low";
  if (thinking !== "off") body.generationConfig.thinkingConfig = { thinkingLevel: thinking };

  let lastErr = "";
  const live = models.filter((m) => (exhaustedUntil.get(m) ?? 0) < Date.now());
  for (const model of live.length ? live : models) {
    const hasNext = models.indexOf(model) < models.length - 1;
    const maxAttempts = hasNext ? Math.min(retries, 2) : retries; // overloaded model: hop to the next one sooner
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (Date.now() >= runDeadline) throw new GeminiError("run time budget used up");
      try {
        const res = await fetch(`${base}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(3000, Math.min(opts.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS ?? 60_000), runDeadline - Date.now()))),
        });
        if (res.ok) return await res.json();
        const j: any = await res.json().catch(() => ({}));
        lastErr = `${model}: HTTP ${res.status} ${j?.error?.status ?? ""}`.trim();
        if (res.status === 429 && isDailyQuota(j)) {
          exhaustedUntil.set(model, Date.now() + 3_600_000);
          lastErr += " (daily quota)";
          break; // no point retrying this model
        }
        if (res.status === 400 && /thinking/i.test(JSON.stringify(j)) && body.generationConfig.thinkingConfig) {
          delete body.generationConfig.thinkingConfig; // this model does not accept the setting: try again without it
          attempt--;
          continue;
        }
        if (!RETRYABLE.has(res.status)) throw new GeminiError(lastErr, res.status);
        const ra = Number(res.headers.get("retry-after")) || retryAfterSeconds(j) || 0;
        if (attempt < maxAttempts) await sleep(Math.min(ra > 0 ? ra * 1000 + 500 : delay * 2 ** attempt, 40_000) + Math.random() * 500);
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        lastErr = `${model}: network ${(e as Error).name}`; // timeouts and resets are retryable
        if (attempt < maxAttempts) await sleep(delay * 2 ** attempt);
      }
    }
  }
  throw new GeminiError(`Gemini failed (${lastErr})`);
}

/** Structured call: returns parsed JSON that matches the schema. */
export async function geminiJson<T>(req: GeminiRequest & { schema: object }, opts?: Parameters<typeof geminiRaw>[1]): Promise<T> {
  const j = await geminiRaw(req, opts);
  const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  if (!text) throw new GeminiError(`empty Gemini answer (finish: ${j?.candidates?.[0]?.finishReason ?? "unknown"})`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError("Gemini returned invalid JSON");
  }
}

// ---- schema helpers (OpenAPI-style) ----
export const S = {
  str: (nullable = false) => ({ type: "STRING", nullable }),
  num: (nullable = true) => ({ type: "NUMBER", nullable }),
  bool: () => ({ type: "BOOLEAN" }),
  enum: (values: string[]) => ({ type: "STRING", enum: values }),
  arr: (items: object) => ({ type: "ARRAY", items }),
  obj: (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: "OBJECT", properties, required }),
};

/** Google Search grounded answer (optional feature, GEMINI_SEARCH_ENABLED=true). Returns text and source titles. */
export async function geminiSearch(prompt: string): Promise<{ text: string; titles: string[] }> {
  const j = await geminiRaw({ prompt, grounding: true, temperature: 0 }, { retries: 2 });
  const c = j?.candidates?.[0];
  return {
    text: (c?.content?.parts ?? []).map((p: any) => p.text ?? "").join(""),
    titles: (c?.groundingMetadata?.groundingChunks ?? []).map((x: any) => String(x?.web?.title ?? "")).filter(Boolean),
  };
}
