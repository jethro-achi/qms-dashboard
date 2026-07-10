"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle,
  AttachmentDescription, AttachmentActions, AttachmentAction, AttachmentTrigger,
} from "@/components/ui/attachment"
import { cn } from "@/lib/utils"
import {
  SendIcon, PaperclipIcon, XIcon, PencilIcon, Trash2Icon, CheckIcon,
  FileTextIcon, DownloadIcon,
} from "lucide-react"

interface Contact {
  id: number
  name: string
  email: string
  roleLabel: string
  unread: number
}
interface AttachmentMeta { name: string; mime: string; size: number }
interface Message {
  id: number
  body: string
  createdAt: string
  editedAt: string | null
  mine: boolean
  attachment: AttachmentMeta | null
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return (p.slice(0, 2).map((s) => s[0] ?? "").join("") || "?").toUpperCase()
}
function timeLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}
function fmtSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function MessagesClient() {
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [activeId, setActiveId] = React.useState<number | null>(null)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [draft, setDraft] = React.useState("")
  const [pendingFile, setPendingFile] = React.useState<File | null>(null)
  const [sending, setSending] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  // Inline edit + multi-select delete state.
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [editText, setEditText] = React.useState("")
  const [selectMode, setSelectMode] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())

  const loadContacts = React.useCallback(async () => {
    const res = await fetch("/api/messages", { cache: "no-store" })
    if (res.ok) setContacts((await res.json()).contacts ?? [])
  }, [])
  const loadThread = React.useCallback(async (id: number) => {
    const res = await fetch(`/api/messages/${id}`, { cache: "no-store" })
    if (res.ok) setMessages((await res.json()).messages ?? [])
  }, [])

  React.useEffect(() => { void loadContacts() }, [loadContacts])

  // Open a specific conversation when arriving from a notifier card (?to=<id>).
  React.useEffect(() => {
    const to = Number(new URLSearchParams(window.location.search).get("to"))
    if (Number.isInteger(to) && to > 0) {
      setActiveId(to)
      setContacts((cs) => cs.map((c) => (c.id === to ? { ...c, unread: 0 } : c)))
    }
    // Mount-only: honour the initial deep-link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (activeId == null) return
    void loadThread(activeId)
    const t = setInterval(() => {
      // Don't clobber an in-progress edit with polled data.
      if (editingId == null) void loadThread(activeId)
      void loadContacts()
    }, 5000)
    return () => clearInterval(t)
  }, [activeId, loadThread, loadContacts, editingId])

  function openContact(id: number) {
    setActiveId(id)
    setMessages([])
    setSelectMode(false)
    setSelected(new Set())
    setEditingId(null)
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)))
  }

  async function send() {
    const body = draft.trim()
    if ((!body && !pendingFile) || activeId == null) return
    setSending(true)
    try {
      let res: Response
      if (pendingFile) {
        const fd = new FormData()
        fd.append("recipientId", String(activeId))
        fd.append("body", body)
        fd.append("file", pendingFile)
        res = await fetch("/api/messages", { method: "POST", body: fd })
      } else {
        res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientId: activeId, body }),
        })
      }
      if (res.ok) {
        setDraft("")
        setPendingFile(null)
        if (fileRef.current) fileRef.current.value = ""
        await loadThread(activeId)
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? "Could not send the message.")
      }
    } finally {
      setSending(false)
    }
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) { toast.error("Attachment exceeds the 10 MB limit."); return }
    setPendingFile(f)
  }

  async function saveEdit(id: number) {
    const text = editText.trim()
    if (!text) return
    const res = await fetch("/api/messages/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, body: text }),
    })
    if (res.ok) {
      setEditingId(null)
      if (activeId) await loadThread(activeId)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? "Could not edit the message.")
    }
  }

  async function deleteIds(ids: number[]) {
    if (ids.length === 0) return
    const res = await fetch("/api/messages/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
    if (res.ok) {
      setSelected(new Set())
      setSelectMode(false)
      if (activeId) await loadThread(activeId)
      toast.success(ids.length > 1 ? `${ids.length} messages deleted.` : "Message deleted.")
    } else {
      toast.error("Could not delete.")
    }
  }

  function toggleSelect(id: number) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const activeContact = contacts.find((c) => c.id === activeId) ?? null
  const myMessageCount = messages.filter((m) => m.mine).length

  return (
    <div className="px-4 lg:px-6">
      <div className="flex h-[calc(100vh-10rem)] overflow-hidden rounded-none border bg-card">
        {/* Contacts */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r">
          <div className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Contacts</div>
          {contacts.length === 0 && <p className="px-3 text-sm text-muted-foreground">No other users yet.</p>}
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => openContact(c.id)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60",
                activeId === c.id && "bg-muted",
              )}
            >
              <Avatar className="size-8"><AvatarFallback className="text-xs">{initials(c.name)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.unread > 0 && <Badge className="h-5 px-1.5">{c.unread}</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{c.roleLabel}</div>
              </div>
            </button>
          ))}
        </aside>

        {/* Conversation */}
        <section className="flex min-w-0 flex-1 flex-col">
          {activeContact ? (
            <>
              <header className="flex items-center gap-3 border-b px-4 py-2.5">
                <Avatar className="size-8"><AvatarFallback className="text-xs">{initials(activeContact.name)}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{activeContact.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{activeContact.roleLabel} · {activeContact.email}</div>
                </div>
                {myMessageCount > 0 && (
                  selectMode ? (
                    <div className="flex items-center gap-2">
                      <Button variant="destructive" size="sm" disabled={selected.size === 0} onClick={() => void deleteIds([...selected])}>
                        <Trash2Icon /> Delete{selected.size ? ` (${selected.size})` : ""}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setSelectMode(false); setSelected(new Set()) }}>Cancel</Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>Select</Button>
                  )
                )}
              </header>

              <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
                <MessageScroller className="flex-1">
                  <MessageScrollerViewport className="px-4 py-4">
                    <MessageScrollerContent className="gap-3">
                      {messages.length === 0 && (
                        <p className="text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>
                      )}
                      {messages.map((m, i) => (
                        <MessageScrollerItem key={m.id} messageId={String(m.id)} scrollAnchor={i === messages.length - 1} className="flex flex-col">
                          <div className={cn("group flex items-end gap-2", m.mine ? "flex-row-reverse self-end" : "self-start")}>
                            {selectMode && m.mine && (
                              <Checkbox
                                checked={selected.has(m.id)}
                                onCheckedChange={() => toggleSelect(m.id)}
                                className="mb-6"
                                aria-label="Select message"
                              />
                            )}
                            <div className="flex max-w-[78%] flex-col">
                              {editingId === m.id ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editText}
                                    autoFocus
                                    onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { e.preventDefault(); void saveEdit(m.id) }
                                      if (e.key === "Escape") setEditingId(null)
                                    }}
                                    className="min-w-52"
                                  />
                                  <Button size="icon-sm" onClick={() => void saveEdit(m.id)} aria-label="Save"><CheckIcon /></Button>
                                  <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel"><XIcon /></Button>
                                </div>
                              ) : (
                                <div className={cn(
                                  "rounded-none px-3 py-2 text-sm",
                                  m.mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                                )}>
                                  {m.attachment && <MessageAttachment id={m.id} a={m.attachment} mine={m.mine} />}
                                  {m.body && <div className={cn(m.attachment && "mt-1.5")}>{m.body}</div>}
                                </div>
                              )}
                              <span className={cn("mt-1 text-[11px] text-muted-foreground", m.mine ? "self-end" : "self-start")}>
                                {timeLabel(m.createdAt)}{m.editedAt ? " · edited" : ""}
                              </span>
                            </div>

                            {/* hover actions on my own messages */}
                            {m.mine && !selectMode && editingId !== m.id && (
                              <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100">
                                {m.body && (
                                  <Button size="icon-xs" variant="ghost" aria-label="Edit"
                                    onClick={() => { setEditingId(m.id); setEditText(m.body) }}>
                                    <PencilIcon />
                                  </Button>
                                )}
                                <Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => void deleteIds([m.id])}>
                                  <Trash2Icon />
                                </Button>
                              </div>
                            )}
                          </div>
                        </MessageScrollerItem>
                      ))}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton direction="end" />
                </MessageScroller>
              </MessageScrollerProvider>

              {/* Composer */}
              <div className="border-t p-3">
                {pendingFile && (
                  <div className="mb-2">
                    <Attachment size="sm" className="max-w-xs">
                      <AttachmentMedia><FileTextIcon /></AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{pendingFile.name}</AttachmentTitle>
                        <AttachmentDescription>{fmtSize(pendingFile.size)}</AttachmentDescription>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction aria-label="Remove attachment"
                          onClick={() => { setPendingFile(null); if (fileRef.current) fileRef.current.value = "" }}>
                          <XIcon />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input ref={fileRef} type="file" hidden onChange={pickFile}
                    accept="image/*,application/pdf,.csv,.txt,.xlsx,.xls,.doc,.docx,.zip" />
                  <Button variant="ghost" size="icon" aria-label="Attach a file" onClick={() => fileRef.current?.click()}>
                    <PaperclipIcon />
                  </Button>
                  <Input
                    value={draft}
                    placeholder={`Message ${activeContact.name}…`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send() } }}
                  />
                  <Button onClick={() => void send()} disabled={sending || (!draft.trim() && !pendingFile)} size="icon">
                    <SendIcon /><span className="sr-only">Send</span>
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a contact to start messaging.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MessageAttachment({ id, a, mine }: { id: number; a: AttachmentMeta; mine: boolean }) {
  const href = `/api/messages/attachment/${id}`
  if (a.mime.startsWith("image/")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={a.name} className="max-h-56 max-w-full rounded-none border object-contain" />
      </a>
    )
  }
  return (
    <Attachment size="sm" className={cn("relative max-w-xs", mine && "border-primary-foreground/30 bg-primary-foreground/10")}>
      <AttachmentMedia><FileTextIcon /></AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{a.name}</AttachmentTitle>
        <AttachmentDescription>{fmtSize(a.size)}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={`Download ${a.name}`} render={<a href={href} download={a.name} />}>
          <DownloadIcon />
        </AttachmentAction>
      </AttachmentActions>
      <AttachmentTrigger render={<a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${a.name}`} />} />
    </Attachment>
  )
}
