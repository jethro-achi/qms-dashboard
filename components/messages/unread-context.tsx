"use client"

import * as React from "react"

export interface UnreadPreview {
  messageId: number
  senderId: number
  senderName: string
  roleLabel: string
  preview: string
  hasAttachment: boolean
  createdAt: string
}

interface UnreadState {
  total: number
  latest: UnreadPreview[]
  dismissed: Set<number>
  dismiss: (messageId: number) => void
  refresh: () => void
}

const Ctx = React.createContext<UnreadState | null>(null)

export function useUnread(): UnreadState {
  return (
    React.useContext(Ctx) ?? {
      total: 0, latest: [], dismissed: new Set(),
      dismiss: () => {}, refresh: () => {},
    }
  )
}

/**
 * Single app-wide poller for unread messages. Feeds both the sidebar badge and
 * the floating bottom-right previews, so we poll once regardless of how many
 * consumers there are.
 */
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [total, setTotal] = React.useState(0)
  const [latest, setLatest] = React.useState<UnreadPreview[]>([])
  const [dismissed, setDismissed] = React.useState<Set<number>>(new Set())

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/messages/unread", { cache: "no-store" })
      if (!res.ok) return
      const data = await res.json()
      setTotal(Number(data.total ?? 0))
      setLatest(Array.isArray(data.latest) ? data.latest : [])
    } catch { /* offline / transient — keep last known */ }
  }, [])

  React.useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 12000)
    // Refresh promptly when the tab regains focus.
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus) }
  }, [refresh])

  const dismiss = React.useCallback((id: number) => {
    setDismissed((s) => new Set(s).add(id))
  }, [])

  const value = React.useMemo<UnreadState>(
    () => ({ total, latest, dismissed, dismiss, refresh }),
    [total, latest, dismissed, dismiss, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
