// next.config.mjs
// -----------------------------------------------------------------------------
// Static security headers, plus standalone output so the on-prem Docker image
// stays small.
//
// NOTE: the Content-Security-Policy is NOT here — it needs a per-request nonce,
// so it's generated in middleware.ts (see the nonce/strict-dynamic policy
// there). Keeping it out of this static list avoids two conflicting CSP headers.
// -----------------------------------------------------------------------------

/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// CSP for Next's immutable static assets (/_next/static, /_next/image).
// middleware.ts owns the real, nonce-based policy but its matcher deliberately
// skips these paths for performance — so without this they'd ship NO CSP at all,
// which security scanners flag as "CSP header not set".
//
// This is safe to add here precisely BECAUSE these are subresources: a browser
// enforces the *document's* CSP when loading scripts/styles/images, and ignores
// the CSP on the subresource's own response. So this policy never restricts the
// app; it only bites if one of these files is opened directly as a top-level
// document, where making it inert is exactly what we want. It is scoped to these
// paths so it can never collide with the nonce policy on real documents (two CSP
// headers intersect, which would break every script on the page).
const STATIC_ASSET_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox";

// "standalone" output produces the small self-contained bundle for the on-prem
// Linux Docker image. Its final step symlinks node_modules, which native
// Windows blocks with EPERM unless Developer Mode / admin is on — and it isn't
// needed for a local `next start` anyway. So skip it on Windows (Docker builds
// run on Linux and still get it). Force off anywhere with NEXT_DISABLE_STANDALONE=1.
const useStandalone =
  process.env.NEXT_DISABLE_STANDALONE !== "1" && process.platform !== "win32";

const nextConfig = {
  output: useStandalone ? "standalone" : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  // pdfkit ships font-metric (.afm) data files it loads at runtime; bundling it
  // breaks those paths. Keep it external so it loads from node_modules.
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Paths middleware.ts skips — give them a CSP so no response is without one.
      { source: "/_next/static/:path*", headers: [{ key: "Content-Security-Policy", value: STATIC_ASSET_CSP }] },
      { source: "/_next/image", headers: [{ key: "Content-Security-Policy", value: STATIC_ASSET_CSP }] },
    ];
  },
};

export default nextConfig;
