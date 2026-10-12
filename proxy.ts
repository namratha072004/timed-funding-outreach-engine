import { NextResponse, type NextRequest } from "next/server";
import { bearerOk, COOKIE, cookieOk } from "./lib/auth";

// Everything needs the access code, except the unlock page itself. /api/run also accepts the cron bearer token.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/unlock" || pathname === "/api/unlock") return NextResponse.next();
  if (pathname === "/api/run" && bearerOk(req.headers.get("authorization"))) return NextResponse.next();
  if (await cookieOk(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/unlock", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
