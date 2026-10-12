/** Gmail: drafts only (scope gmail.compose). Nothing here ever sends. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function accessToken(): Promise<string> {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) throw new Error("Google OAuth env vars not set");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Gmail token exchange failed (HTTP ${r.status})`);
  return (await r.json()).access_token;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

/** RFC 2822 message. To is included only when given; the caller passes it for Hunter-verified emails only. */
export function buildRaw(o: { to: string | null; subject: string; body: string }): string {
  const safe = (s: string) => s.replace(/[\r\n]+/g, " ");
  const lines = [
    ...(o.to ? [`To: ${safe(o.to)}`] : []),
    `Subject: ${encodeHeader(safe(o.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(o.body.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return b64url(lines.join("\r\n"));
}

/** Creates a draft in the Drafts folder. Returns "draftId:messageId". Retries 429/5xx. */
export async function createGmailDraft(o: { to: string | null; subject: string; body: string }): Promise<string> {
  const token = await accessToken();
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { raw: buildRaw(o) } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) {
      const j: any = await r.json();
      return `${j.id}:${j.message?.id ?? ""}`;
    }
    last = `HTTP ${r.status}`;
    if (r.status !== 429 && r.status < 500) break;
    await sleep(1500 * 2 ** attempt);
  }
  throw new Error(`Gmail draft failed (${last})`);
}

/**
 * Gmail link to one draft. The message id must be the draft's CURRENT one (updating a draft gives it a new id), and the
 * account is named in the URL so it opens in the right Google account, not whichever one the browser has as "0".
 * Pure.
 */
export const gmailDraftUrl = (account: string | null, messageId: string | null): string => {
  const base = `https://mail.google.com/mail/u/${account ? encodeURIComponent(account) : "0"}/`;
  return messageId ? `${base}#drafts?compose=${messageId}` : `${base}#drafts`;
};

/** Older call sites: builds the link from the stored "draftId:messageId" (the message id may be stale; prefer resolveGmailDraft). */
export const gmailLink = (stored: string | null): string => gmailDraftUrl(null, stored?.split(":")[1] ?? null);

let accountCache: string | null = null;
/** The Gmail address the drafts live in (cached for the life of the server instance). */
export async function gmailAccount(): Promise<string | null> {
  if (accountCache) return accountCache;
  try {
    const token = await accessToken();
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    accountCache = ((await r.json()) as any)?.emailAddress ?? null;
  } catch {
    /* the link still works with u/0 */
  }
  return accountCache;
}

export type GmailDraftState = { state: "ok"; stored: string; url: string } | { state: "missing" } | { state: "none" };

/**
 * Looks the draft up in Gmail right now. "missing" = Gmail says it no longer exists (deleted, or sent), "none" = the
 * app never created one. On "ok" the returned `stored` has the current message id, so the caller can refresh the saved id.
 */
export async function resolveGmailDraft(stored: string | null): Promise<GmailDraftState> {
  const id = stored?.split(":")[0];
  if (!id) return { state: "none" };
  const token = await accessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}?format=minimal`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 404) return { state: "missing" };
  if (!r.ok) throw new Error(`Gmail lookup failed (HTTP ${r.status})`);
  const j: any = await r.json();
  const messageId: string | null = j?.message?.id ?? null;
  return { state: "ok", stored: `${id}:${messageId ?? ""}`, url: gmailDraftUrl(await gmailAccount(), messageId) };
}

/** Replace the content of an existing draft (still a draft; nothing is sent). */
export async function updateGmailDraft(stored: string, o: { to: string | null; subject: string; body: string }): Promise<void> {
  const id = stored.split(":")[0];
  const token = await accessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { raw: buildRaw(o) } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Gmail draft update failed (HTTP ${r.status})`);
}

/** Removes a draft from Gmail (used by the link test to clean up after itself; the dashboard never deletes drafts). */
export async function deleteGmailDraft(stored: string): Promise<void> {
  const token = await accessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(stored.split(":")[0]!)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok && r.status !== 404) throw new Error(`Gmail delete failed (HTTP ${r.status})`);
}
