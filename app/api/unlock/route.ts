import { NextResponse } from "next/server";
import { codeOk, COOKIE, expectedCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const code = String(form?.get("code") ?? "");
  if (!(await codeOk(code))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return NextResponse.redirect(new URL("/unlock?error=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(COOKIE, (await expectedCookie())!, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
