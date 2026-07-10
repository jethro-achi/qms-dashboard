"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

// Wraps next-themes so individual users can flip light/dark and have it stick
// (localStorage), while the super-admin's app-wide choice remains the DEFAULT
// for anyone who hasn't toggled. next-themes injects a tiny blocking script to
// set the <html> class before paint (no flash) — we pass the CSP nonce so it is
// allowed under the strict script policy in middleware.ts.
export function ThemeProvider({
  children,
  defaultTheme,
  nonce,
}: {
  children: React.ReactNode
  defaultTheme: "light" | "dark"
  nonce?: string
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="qms-theme"
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  )
}
