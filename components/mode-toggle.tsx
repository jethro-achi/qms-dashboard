"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { SunIcon, MoonIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// A visible light/dark switch for the header. Renders a neutral placeholder
// until mounted so the button doesn't mismatch during hydration.
export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {mounted && isDark ? <MoonIcon /> : <SunIcon />}
      <span className="hidden sm:inline">{mounted && isDark ? "Dark" : "Light"}</span>
    </Button>
  )
}
