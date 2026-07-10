// app/not-found.tsx
// -----------------------------------------------------------------------------
// Shown for any unmatched route (or an explicit notFound()). Server component —
// no client JS needed. Renders inside the root layout so the theme applies.
// -----------------------------------------------------------------------------

import Link from "next/link"
import { CompassIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
      >
        <CompassIcon className="size-6" />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or you don&apos;t
          have access to it.
        </p>
      </div>
      <Button render={<Link href="/dashboard" />} variant="default">
        Back to dashboard
      </Button>
    </div>
  )
}
