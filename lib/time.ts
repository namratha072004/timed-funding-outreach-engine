/** "6 h ago", "3 days ago". Pure; `now` is injectable for tests. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "unknown";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const IST = "Asia/Kolkata";

export function istStamp(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("en-GB", { timeZone: IST, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "-";
}

/** Morning until 12:00 IST, afternoon until 17:00, evening after. */
export function greeting(now: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).format(now)) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export const todayIst = (now: Date = new Date()) => now.toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "long" });

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function hoursLabel(h: number | null): string {
  if (h == null) return "-";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
}
