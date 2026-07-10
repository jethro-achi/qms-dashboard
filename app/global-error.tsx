"use client"

// app/global-error.tsx
// -----------------------------------------------------------------------------
// Last-resort boundary: catches errors thrown by the ROOT layout itself, where
// app/error.tsx cannot help because the layout (and its providers/CSS) never
// mounted. Next.js requires this file to render its own <html>/<body>.
//
// Because the app's Tailwind stylesheet may not have loaded at this point, the
// styling here is inline (allowed by the CSP's `style-src 'unsafe-inline'`) and
// theme-neutral so it renders correctly with no design tokens available.
// -----------------------------------------------------------------------------

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app/global-error]", error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#0b0b0c",
          color: "#e7e7e8",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            The application hit an unexpected error
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#a1a1aa", margin: "0 0 20px" }}>
            The page could not be displayed. This has been logged for the
            administrator.
            {error.digest ? ` Reference: ${error.digest}.` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              cursor: "pointer",
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#fafafa",
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 0,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
