// middleware.ts
// -----------------------------------------------------------------------------
// Two jobs, on every document request:
//
// 1. Content-Security-Policy with a PER-REQUEST NONCE. Next.js reads the nonce
//    from the request's CSP header and stamps it on the framework scripts it
//    injects; `'strict-dynamic'` then lets those trusted scripts load the rest
//    of the chunks. This means production needs NO 'unsafe-inline' /
//    'unsafe-eval' for scripts — the strict posture the app advertises.
//    Development is kept looser (Fast Refresh evaluates code via eval() and
//    injects HMR scripts), since dev is not the security boundary.
//    Inline STYLE attributes (style={{…}}) are governed by style-src and can't
//    practically be nonced, so 'unsafe-inline' is retained for styles only —
//    styles can't execute script, so the XSS risk is negligible.
//
// 2. COARSE auth gate: bounce requests without a session cookie to /login. The
//    real authorization boundary is server-side in every route/page — never
//    rely on this alone.
//
// It deliberately does NOT import lib/auth (Node-only mysql2/argon2 can't run in
// the Edge runtime).
// -----------------------------------------------------------------------------

import { NextResponse, type NextRequest } from "next/server";

// Cookie names Auth.js uses (secure-prefixed in production over HTTPS).
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

function hasSession(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => req.cookies.has(name));
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  // Production: nonce + strict-dynamic, no inline/eval for scripts.
  // Development: allow inline + eval so Fast Refresh / HMR work.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    scriptSrc,
    // Inline style attributes are used throughout; styles can't run script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  const { pathname } = req.nextUrl;

  // Public paths reachable without a session. /setup and its API back the
  // first-run wizard; the route handlers refuse once the app is configured.
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/setup") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/setup") ||
    pathname.startsWith("/api/branding") ||
    // Unauthenticated operational probe (load balancer / Docker HEALTHCHECK).
    pathname === "/api/health" ||
    // Cron trigger for scheduled reports: authorized by CRON_SECRET, not a
    // session (the server's scheduler has no cookie). The handler fails closed.
    pathname.startsWith("/api/reports/run-due") ||
    pathname === "/favicon.ico";

  if (!isPublic && !hasSession(req)) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  // Routes that stream user-supplied binary content (uploaded logo, message
  // attachments) get a locked-down sandbox CSP instead of the app policy — the
  // middleware runs on them too, and its response header would otherwise
  // overwrite the one the route sets. `sandbox` + `default-src 'none'` makes any
  // active content inert if the file is ever opened as a top-level document.
  const isRawUserContent =
    pathname.startsWith("/api/branding/") || pathname.startsWith("/api/messages/attachment/");
  const responseCsp = isRawUserContent
    ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    : csp;

  // Forward the nonce + CSP on the REQUEST so Next.js can nonce its scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", responseCsp);
  return res;
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|css|js)$).*)"],
};
