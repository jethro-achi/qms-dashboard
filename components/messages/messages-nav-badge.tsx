"use client"

import { useUnread } from "./unread-context"

/** Live unread-count pill shown on the sidebar "Messages" item. */
export function MessagesNavBadge() {
  const { total } = useUnread()
  if (total <= 0) return null
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
      {total > 99 ? "99+" : total}
    </span>
  )
}
