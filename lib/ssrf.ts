import dns from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as ufetch } from "undici";

/** True for loopback, private, link-local, CGNAT, multicast, reserved and unspecified addresses (v4 and v6). */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    return (
      x === "::" || x === "::1" ||
      /^f[cd]/.test(x) || // fc00::/7 unique local
      /^fe[89ab]/.test(x) || // fe80::/10 link-local
      x.startsWith("ff") || // multicast
      x.startsWith("64:ff9b") || x.startsWith("2001:db8")
    );
  }
  return true; // not an IP at all: treat as unsafe
}

export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("blocked: invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked: only http and https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedIp(host)) throw new Error("blocked: private address");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("blocked: local host name");
  return u;
}

// The connection itself resolves the name and rejects private answers, so DNS rebinding cannot swap the address after the check.
const agent = new Agent({
  connect: {
    lookup: (hostname: string, opts: any, cb: any) => {
      dns.lookup(hostname, { all: true, family: opts?.family }, (err, addrs) => {
        if (err) return cb(err);
        if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(new Error("blocked: private address"));
        if (opts?.all) return cb(null, addrs);
        cb(null, addrs[0]!.address, addrs[0]!.family);
      });
    },
  },
});

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
}

/** SSRF-safe GET: http/https only, no private addresses, capped size and time, limited redirects. Returns text. */
export async function safeFetchText(url: string, o: SafeFetchOptions = {}): Promise<{ text: string; finalUrl: string; status: number; contentType: string }> {
  const maxBytes = o.maxBytes ?? 1_500_000;
  const timeout = o.timeoutMs ?? 10_000;
  const maxRedirects = o.maxRedirects ?? 3;
  let current = checkUrl(url).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await ufetch(current, {
      dispatcher: agent,
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
      headers: { "user-agent": "OutreachEngine/1.0 (+funding news reader)", accept: o.accept ?? "text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,*/*;q=0.5" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = checkUrl(new URL(res.headers.get("location")!, current).toString()).toString();
      await res.body?.cancel();
      continue;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    return { text, finalUrl: current, status: res.status, contentType: res.headers.get("content-type") ?? "" };
  }
  throw new Error("blocked: too many redirects");
}
