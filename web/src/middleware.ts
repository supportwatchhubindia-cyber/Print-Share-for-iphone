import { NextResponse, type NextRequest } from "next/server";

/**
 * Sets the internal request headers the app relies on:
 *  - x-ps-path: current path (for post-login redirects from server layouts)
 *  - x-ps-client-ip / x-ps-proto on Vercel, derived from Vercel's own headers. Any client-sent
 *    copies are overwritten, so they can't be spoofed. Self-hosted, server.ts sets these.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-ps-path", req.nextUrl.pathname);
  if (process.env.VERCEL) {
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    headers.set("x-ps-client-ip", ip);
    headers.set("x-ps-proto", req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https");
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|pdfjs/|sw.js|manifest.webmanifest|favicon).*)"],
};
