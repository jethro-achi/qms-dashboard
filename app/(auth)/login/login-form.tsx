// app/(auth)/login/login-form.tsx
"use client"

import * as React from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { QmsIllustration } from "@/components/qms-illustration"

export default function LoginForm({ logoSrc }: { logoSrc?: string | null }) {
  const router = useRouter()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("expired") === "1") {
      setNotice("Your session timed out for security. Please sign in again.")
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await signIn("credentials", { email, password, redirect: false })
    setBusy(false)
    if (res?.error) {
      setError("Sign-in failed. Check your email and password.")
      return
    }
    const callbackUrl = new URLSearchParams(window.location.search).get("callbackUrl") ?? "/dashboard"
    router.push(callbackUrl)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4 md:p-6">
      <div className="w-full max-w-4xl">
        <Card className="overflow-hidden p-0">
          <CardContent className="grid p-0 md:grid-cols-2">
            <form className="p-6 md:p-8" onSubmit={onSubmit}>
              <FieldGroup>
                <div className="flex flex-col items-center gap-3 text-center">
                  {logoSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoSrc} alt="Logo" className="max-h-16 w-auto object-contain" />
                  ) : (
                    <div className="text-xl font-bold">QMS Analytics</div>
                  )}
                  <div className="space-y-1">
                    <h1 className="text-2xl font-bold">Welcome back</h1>
                    <p className="text-sm text-muted-foreground">
                      Sign in to the Queue Management dashboard
                    </p>
                  </div>
                </div>

                {notice && (
                  <p className="rounded-none border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-700 dark:text-amber-400">
                    {notice}
                  </p>
                )}

                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Field>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                </Field>
              </FieldGroup>
            </form>

            <div className="relative hidden flex-col items-center justify-center gap-6 bg-gradient-to-b from-primary/10 to-primary/5 p-8 md:flex">
              <QmsIllustration className="w-full max-w-sm" />
              <div className="space-y-1 text-center">
                <p className="font-semibold">Queue Management Insights</p>
                <p className="text-sm text-muted-foreground">
                  Traffic, wait times, SLA and staff performance — at a glance.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
