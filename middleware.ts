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
//    styles can't execute script, so the XSS risk is negligible. See buildCsp()
//    and SECURITY.md for why this can't be tightened.
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

/**
 * True for a request that looks like a static file served out of public/:
 * outside /api and ending in a file extension (e.g. /favicon.ico, /logo.png).
 * App routes never contain a dot, so this can't accidentally expose a page.
 */
function isPublicFile(pathname: string): boolean {
  return !pathname.startsWith("/api/") && /\.[a-zA-Z0-9]+$/.test(pathname);
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
    // Styles keep 'unsafe-inline'. This is a DELIBERATE, evidence-based
    // acceptance, not an oversight — see SECURITY.md "style-src 'unsafe-inline'".
    // Short version: it cannot be removed without breaking the app.
    //   - SERVER-RENDERED style ATTRIBUTES (the <html> brand-theme vars, ~29 of
    //     our own components) serialise into literal style="…" in the HTML and
    //     can never be nonced — only <style> ELEMENTS can be. (Client-rendered
    //     style={{…}} goes through the CSSOM and isn't CSP-governed at all.)
    //   - Locking style-src-elem was tried and VERIFIED BROKEN in headless
    //     Chrome: two un-nonced <style> ELEMENTS are refused — sonner (toasts,
    //     third-party, exposes no nonce option) and our own ChartStyle in
    //     components/ui/chart.tsx. Fixing ours alone buys nothing while sonner
    //     still forces the directive open.
    // Residual risk is low: styles can't execute script, exploiting this needs an
    // HTML-injection foothold (script-src is nonce + strict-dynamic), and CSS
    // exfiltration is dead because default-src/img-src/font-src/connect-src are
    // all 'self' — injected CSS has no external origin to reach.
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
    // Static files served from public/ — anything outside /api with a file
    // extension (favicon.ico, images, fonts, manifest…). Next routes public/
    // through the middleware (unlike /_next/static), so without this they'd be
    // bounced to /login and e.g. login-page imagery would never load for a
    // signed-out visitor. Files in public/ are public BY DEFINITION — that is
    // what the directory means — so this grants nothing that wasn't already
    // intended. Never put anything sensitive in public/; it is not access-
    // controlled by anything, here or in Next.
    //
    // Security note: this only skips the coarse AUTH gate. These responses still
    // get the full CSP, because the matcher below no longer skips them — that
    // was the actual hole (an HTML 404 with no CSP on any *.js path).
    isPublicFile(pathname);

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
  // Run on everything except Next's immutable build assets.
  //
  // This deliberately does NOT exclude by file EXTENSION. It previously also
  // skipped `*.png|jpg|jpeg|svg|ico|css|js`, on the assumption such paths are
  // static files — but nothing is served from a public/ dir here, so Next answers
  // them with the not-found PAGE: a full HTML document. Skipping the middleware
  // meant every one of those URLs (/favicon.ico, /anything.js, …) returned an
  // HTML 404 carrying NO Content-Security-Policy and un-nonced scripts — i.e. a
  // CSP-free document on our own origin, reachable by guessing any *.js path.
  // They now get the normal nonce policy.
  //
  // /_next/static and /_next/image are the only genuinely static responses, and
  // they're covered by STATIC_ASSET_CSP in next.config.mjs — so no response is
  // left without a CSP.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
