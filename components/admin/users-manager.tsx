"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogClose, AlertDialogActionButton,
} from "@/components/ui/alert-dialog"
import { ROLES, ROLE_LABELS, seesAllBranches, type Role } from "@/lib/rbac"
import type { ManagedUser } from "@/lib/users"

interface BranchOption { id: string; name: string }

const roleItems = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))

export function UsersManager({
  users,
  branches,
  currentUserId,
}: {
  users: ManagedUser[]
  branches: BranchOption[]
  currentUserId: number
}) {
  const router = useRouter()
  const branchName = React.useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ManagedUser | null>(null)
  const [busy, setBusy] = React.useState(false)
  // Pending destructive action awaiting explicit confirmation.
  const [confirming, setConfirming] = React.useState<
    | { kind: "delete"; user: ManagedUser }
    | { kind: "reset"; user: ManagedUser }
    | null
  >(null)

  const [email, setEmail] = React.useState("")
  const [fullName, setFullName] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [role, setRole] = React.useState<Role>("BRANCH_OPS")
  const [isActive, setIsActive] = React.useState(true)
  const [branchIds, setBranchIds] = React.useState<Set<string>>(new Set())

  const branchScoped = !seesAllBranches(role)

  function openAdd() {
    setEditing(null)
    setEmail(""); setFullName(""); setPassword(""); setNewPassword("")
    setRole("BRANCH_OPS"); setIsActive(true); setBranchIds(new Set())
    setOpen(true)
  }
  function openEdit(u: ManagedUser) {
    setEditing(u)
    setEmail(u.email); setFullName(u.fullName); setPassword(""); setNewPassword("")
    setRole(u.role); setIsActive(u.isActive); setBranchIds(new Set(u.branchIds))
    setOpen(true)
  }

  function toggleBranch(id: string) {
    setBranchIds((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // Clicking Save: a password reset on an existing user is a destructive action,
  // so route it through a confirmation dialog first. Everything else saves directly.
  function onSaveClick() {
    if (editing && newPassword) {
      setConfirming({ kind: "reset", user: editing })
      return
    }
    void doSave()
  }

  async function doSave() {
    setBusy(true)
    try {
      if (editing) {
        const res = await fetch(`/api/admin/users/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, role, isActive, branchIds: [...branchIds] }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data?.error ?? "Could not update user."); return }
        if (newPassword) {
          const pr = await fetch(`/api/admin/users/${editing.id}/password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: newPassword }),
          })
          const pd = await pr.json().catch(() => ({}))
          if (!pr.ok) { toast.error(pd?.error ?? "Could not reset password."); return }
        }
        toast.success("User updated.")
      } else {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, fullName, password, role, branchIds: [...branchIds] }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data?.error ?? "Could not create user."); return }
        toast.success("User created.")
      }
      setOpen(false)
      router.refresh()
    } catch {
      toast.error("Request failed.")
    } finally {
      setBusy(false)
    }
  }

  async function doRemove(u: ManagedUser) {
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data?.error ?? "Could not delete user."); return }
    toast.success("User removed.")
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users.length} user{users.length === 1 ? "" : "s"}</p>
        <Button size="sm" onClick={openAdd}>
          <PlusIcon className="h-4 w-4" /> Add user
        </Button>
      </div>

      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Branches</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.fullName}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                <TableCell>
                  {seesAllBranches(u.role) ? (
                    <span className="text-muted-foreground">All branches</span>
                  ) : u.branchIds.length ? (
                    <div className="flex flex-wrap gap-1">
                      {u.branchIds.map((id) => (
                        <Badge key={id} variant="secondary">{branchName.get(id) ?? id.slice(0, 8)}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">None assigned</span>
                  )}
                </TableCell>
                <TableCell>
                  {u.isActive ? (
                    <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(u)} aria-label="Edit">
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                  {u.id !== currentUserId && (
                    <Button variant="ghost" size="icon" onClick={() => setConfirming({ kind: "delete", user: u })} aria-label="Delete" className="text-rose-600 dark:text-rose-400">
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit user" : "Add user"}</SheetTitle>
            <SheetDescription>
              {editing ? "Update role, branch access, status, or reset the password." : "Create an account. They sign in with their work email and password."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-auto px-4 pb-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} disabled={!!editing} placeholder="user@company.com"
                onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Full name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            {!editing && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Password</label>
                <Input type="password" value={password} autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)} />
                <span className="text-xs text-muted-foreground">At least 12 characters.</span>
              </div>
            )}
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Role</label>
              <Select items={roleItems} value={role} onValueChange={(v) => setRole((v as Role) ?? "BRANCH_OPS")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleItems.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {branchScoped && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Branch access</label>
                <div className="flex max-h-52 flex-col gap-2 overflow-auto rounded-md border p-3">
                  {branches.length === 0 && <span className="text-xs text-muted-foreground">No QMS branches found.</span>}
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={branchIds.has(b.id)} onCheckedChange={() => toggleBranch(b.id)} />
                      <span>{b.name}</span>
                    </label>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">This user only sees data for the selected branch(es).</span>
              </div>
            )}

            {editing && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
                  Account active
                </label>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Reset password</label>
                  <Input type="password" value={newPassword} placeholder="Leave blank to keep current"
                    autoComplete="new-password" onChange={(e) => setNewPassword(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <SheetFooter className="flex-row gap-2">
            <Button onClick={onSaveClick} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create user"}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Confirmation for destructive actions — text customised per action. */}
      <AlertDialog open={confirming !== null} onOpenChange={(o) => { if (!o) setConfirming(null) }}>
        <AlertDialogContent size="sm">
          {confirming?.kind === "delete" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {confirming.user.fullName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the account for{" "}
                  <span className="font-medium text-foreground">{confirming.user.email}</span> and
                  revokes their access to the dashboard. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose>Cancel</AlertDialogClose>
                <AlertDialogActionButton onClick={() => void doRemove(confirming.user)}>
                  <Trash2Icon className="h-4 w-4" />
                  Delete user
                </AlertDialogActionButton>
              </AlertDialogFooter>
            </>
          )}
          {confirming?.kind === "reset" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset password for {confirming.user.fullName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Their current password stops working immediately. Share the new password with them
                  securely so they can sign back in.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose>Cancel</AlertDialogClose>
                <AlertDialogActionButton variant="default" onClick={() => void doSave()}>
                  Reset password
                </AlertDialogActionButton>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
