import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

const PROTECTED = /^\/(projects(\/|$)|change-password$)/;
const AUTH_PAGES = /^\/(login|setup)$/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED.test(pathname) && !hasSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (AUTH_PAGES.test(pathname) && hasSession) {
    return NextResponse.redirect(new URL("/projects", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/projects/:path*", "/login", "/setup", "/change-password"],
};
