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

export const gmailLink = (stored: string | null): string => {
  const msg = stored?.split(":")[1];
  return msg ? `https://mail.google.com/mail/u/0/#drafts?compose=${msg}` : "https://mail.google.com/mail/u/0/#drafts";
};
