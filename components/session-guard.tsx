"use client"

import * as React from "react"

/**
 * Client-side session sentinel. The JWT session has a fixed lifetime
 * (SESSION_MAX_AGE, 30 min by default). When it expires, server-rendered
 * navigations already bounce to /login — but a tab left open would otherwise sit
 * on a stale page until the user manually refreshed. This watches for expiry and
 * routes to /login itself, preserving the current path as callbackUrl.
 *
 * It polls the (public) Auth.js session endpoint on an interval and whenever the
 * tab regains focus, so returning to an idle tab redirects immediately. A full
 * navigation (not router.push) is used so all client caches/state are cleared on
 * the way out.
 */
export function SessionGuard() {
  React.useEffect(() => {
    let cancelled = false
    let redirecting = false

    async function check() {
      if (cancelled || redirecting) return
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" })
        // 401/redirect or an empty body both mean "no active session".
        const data = res.ok ? await res.json().catch(() => null) : null
        const hasSession = !!data && typeof data === "object" && !!data.user
        if (!hasSession && !cancelled) {
          redirecting = true
          const here = window.location.pathname + window.location.search
          const url = `/login?callbackUrl=${encodeURIComponent(here)}&expired=1`
          window.location.assign(url)
        }
      } catch {
        // Network blip on the intranet — don't log the user out over a transient
        // error; the next tick will re-check.
      }
    }

    const id = window.setInterval(check, 60_000)
    const onFocus = () => void check()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [])

  return null
}
