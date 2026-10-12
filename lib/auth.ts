/**
 * Access code for actions that change data. Reading the dashboard is public.
 * The cookie holds a hash of ACCESS_CODE, never the code itself.
 */
export const COOKIE = "outreach_access";
export const COOKIE_MAX_AGE = 60 * 60 * 12; // the code is asked again after 12 hours

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

/** Testing mode (ACCEPT_ANY_ACCESS_CODE=true): any non-empty code unlocks. Set it to false to enforce ACCESS_CODE. */
export const anyCodeAccepted = () => process.env.ACCEPT_ANY_ACCESS_CODE === "true";

export async function expectedCookie(): Promise<string | null> {
  const code = anyCodeAccepted() ? "testing-mode" : process.env.ACCESS_CODE;
  return code ? sha256Hex(`${code}|outreach-v1`) : null;
}

export async function cookieOk(value: string | undefined | null): Promise<boolean> {
  const exp = await expectedCookie();
  return !!exp && !!value && safeEqual(value, exp);
}

/** Compared against ACCESS_CODE on the server (unless testing mode is on). If ACCESS_CODE is not set, nothing unlocks. */
export async function codeOk(code: string): Promise<boolean> {
  if (anyCodeAccepted()) return code.trim().length > 0;
  const real = process.env.ACCESS_CODE;
  return !!real && code.length > 0 && safeEqual(await sha256Hex(code), await sha256Hex(real));
}

export function bearerOk(header: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && !!header && safeEqual(header, `Bearer ${secret}`);
}

export function cookieFrom(req: Request): string | undefined {
  return req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

/** For API routes: cron bearer token and/or the access cookie. */
export async function authorize(req: Request, o: { cookie: boolean; bearer: boolean }): Promise<boolean> {
  if (o.bearer && bearerOk(req.headers.get("authorization"))) return true;
  return o.cookie && (await cookieOk(cookieFrom(req)));
}
