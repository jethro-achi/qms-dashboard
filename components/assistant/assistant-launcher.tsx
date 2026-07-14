"use client"

import * as React from "react"
import { BrainIcon, SendIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

interface Msg { role: "user" | "assistant"; content: string; error?: boolean }

const SUGGESTIONS = [
  "How many tickets were served in the last 7 days?",
  "What's our average wait time and SLA?",
  "Which branch is busiest?",
  "What are the peak hours?",
]

export function AssistantLauncher() {
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy])

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    const next: Msg[] = [...messages, { role: "user", content: question }]
    setMessages(next)
    setDraft("")
    setBusy(true)
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send only role/content — the server ignores any error flags.
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data?.error ?? "The assistant is unavailable.", error: true }])
      } else {
        setMessages((m) => [...m, { role: "assistant", content: String(data.reply ?? "") }])
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Could not reach the assistant.", error: true }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Floating launcher — the "brain" section, available on every page. */}
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        className="fixed bottom-5 right-5 z-40 size-12 rounded-full shadow-lg"
        aria-label="Open AI assistant"
      >
        <BrainIcon className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <BrainIcon className="size-4 text-primary" /> AI Assistant
            </SheetTitle>
            <SheetDescription>
              Ask about your branches&rsquo; queue data. Answers are scoped to what you can see, and the model runs on-premises.
            </SheetDescription>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Try one of these:</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void ask(s)}
                      className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.error
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" /> Thinking… (running locally)
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                placeholder="Ask about your queue data…"
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft) } }}
              />
              <Button size="icon" disabled={busy || !draft.trim()} onClick={() => void ask(draft)} aria-label="Send">
                {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
