/** Access-code auth. The cookie holds a hash of ACCESS_CODE, never the code itself. */
export const COOKIE = "outreach_access";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Testing mode: the unlock page accepts any non-empty code. Set ACCEPT_ANY_ACCESS_CODE=false to enforce ACCESS_CODE again. */
export const anyCodeAccepted = () => process.env.ACCEPT_ANY_ACCESS_CODE === "true";

export async function expectedCookie(): Promise<string | null> {
  const code = anyCodeAccepted() ? "testing-mode" : process.env.ACCESS_CODE;
  return code ? sha256Hex(`${code}|outreach-v1`) : null;
}

export async function cookieOk(value: string | undefined | null): Promise<boolean> {
  const exp = await expectedCookie();
  return !!exp && !!value && safeEqual(value, exp);
}

export async function codeOk(code: string): Promise<boolean> {
  if (anyCodeAccepted()) return code.trim().length > 0;
  const real = process.env.ACCESS_CODE;
  return !!real && safeEqual(await sha256Hex(code), await sha256Hex(real));
}

export function bearerOk(header: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && !!header && safeEqual(header, `Bearer ${secret}`);
}

function cookieFrom(req: Request): string | undefined {
  return req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

/** For API routes: cron bearer token and/or the access cookie. */
export async function authorize(req: Request, o: { cookie: boolean; bearer: boolean }): Promise<boolean> {
  if (o.bearer && bearerOk(req.headers.get("authorization"))) return true;
  return o.cookie && (await cookieOk(cookieFrom(req)));
}
