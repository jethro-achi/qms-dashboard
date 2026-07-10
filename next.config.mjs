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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
