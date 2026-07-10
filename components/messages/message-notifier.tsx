"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { MessageSquareIcon, PaperclipIcon, XIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useUnread } from "./unread-context"

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return (p.slice(0, 2).map((s) => s[0] ?? "").join("") || "?").toUpperCase()
}

/**
 * Floating bottom-right previews for incoming messages: sender name, role, and a
 * preview of the text or attachment. Clicking opens the conversation. Hidden on
 * the Messages page itself (you're already reading there).
 */
export function MessageNotifier() {
  const { latest, dismissed, dismiss } = useUnread()
  const pathname = usePathname()
  if (pathname?.startsWith("/messages")) return null

  const cards = latest.filter((m) => !dismissed.has(m.messageId)).slice(0, 3)
  if (cards.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {cards.map((m) => (
        <div
          key={m.messageId}
          className="pointer-events-auto flex items-start gap-3 border bg-popover p-3 text-popover-foreground shadow-lg animate-in slide-in-from-right-4 fade-in"
        >
          <a href={`/messages?to=${m.senderId}`} className="flex min-w-0 flex-1 items-start gap-3">
            <Avatar className="size-9 shrink-0"><AvatarFallback className="text-xs">{initials(m.senderName)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <MessageSquareIcon className="size-3.5 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium">{m.senderName}</span>
                <span className="truncate text-xs text-muted-foreground">· {m.roleLabel}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                {m.hasAttachment && <PaperclipIcon className="size-3.5 shrink-0" />}
                <span className="line-clamp-2">{m.preview || "New message"}</span>
              </div>
            </div>
          </a>
          <button
            aria-label="Dismiss"
            onClick={() => dismiss(m.messageId)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
