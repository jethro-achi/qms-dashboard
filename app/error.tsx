"use client"

// app/error.tsx
// -----------------------------------------------------------------------------
// Route-level error boundary. Next.js renders this (inside the root layout, so
// the sidebar/header chrome and theme still apply) whenever a Server Component,
// data fetch, or client render throws in this segment or below.
//
// It deliberately shows NOTHING about the underlying cause to the user — a
// stray stack trace can leak table names, file paths or query shapes. The real
// detail is logged server-side (see the useEffect) where operators can see it;
// `error.digest` is the only correlation id we surface so a user can quote it
// when reporting the problem.
// -----------------------------------------------------------------------------

import { useEffect } from "react"
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the full error in the server/container logs for diagnosis. In the
    // browser this prints to the console; on the server it lands in `docker logs`.
    console.error("[app/error]", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
      >
        <AlertTriangleIcon className="size-6" />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page couldn&apos;t be loaded. This has been logged. You can try
          again, and if it keeps happening, contact your administrator.
        </p>
        {error.digest ? (
          <p className="pt-1 font-mono text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
      <Button onClick={reset} variant="default" className="gap-2">
        <RotateCcwIcon className="size-4" />
        Try again
      </Button>
    </div>
  )
}
