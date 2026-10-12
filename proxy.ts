import { NextResponse, type NextRequest } from "next/server";
import { bearerOk, COOKIE, cookieOk } from "./lib/auth";

/**
 * Pages are public and read-only. Every API call that changes something needs the access cookie, or the cron
 * bearer token for the run routes. The routes check again themselves; this is the first gate.
 * Open on purpose: /api/unlock (it checks the code) and GET /api/run/status (read-only progress).
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/unlock") return NextResponse.next();
  if (req.method === "GET" && pathname === "/api/run/status") return NextResponse.next();
  const bearer = pathname.startsWith("/api/run") && bearerOk(req.headers.get("authorization"));
  if (bearer || (await cookieOk(req.cookies.get(COOKIE)?.value))) return NextResponse.next();
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = { matcher: ["/api/:path*"] };
