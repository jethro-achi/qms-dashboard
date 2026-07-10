// app/setup/setup-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

// Client-side ceiling so an unreachable host can't leave the button spinning
// forever (a refused port fails fast, but a black-holed host would otherwise
// hang until the driver's own timeout).
const TEST_TIMEOUT_MS = 15000;

async function postJson(url: string, payload: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data } as const;
  } finally {
    clearTimeout(timer);
  }
}

interface EngineOption {
  value: string;
  label: string;
  defaultPort: number;
}

type ConnState = "idle" | "testing" | "ok" | "fail";

export default function SetupForm({ engines }: { engines: EngineOption[] }) {
  const router = useRouter();

  const [engine, setEngine] = useState(engines[0]?.value ?? "mysql");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(engines[0]?.defaultPort ?? 3306));
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [ssl, setSsl] = useState(false);

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [conn, setConn] = useState<ConnState>("idle");
  const [busy, setBusy] = useState(false);

  function dbPayload() {
    return { engine, host, port: Number(port), user, password, database, ssl };
  }

  // Any change to a DB field invalidates a prior successful test, forcing a
  // re-test before setup can complete — the connection must reflect the fields
  // actually being submitted.
  function onDbFieldChange<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setConn("idle");
    };
  }

  function onEngineChange(value: string) {
    setEngine(value);
    const match = engines.find((e) => e.value === value);
    if (match) setPort(String(match.defaultPort));
    setConn("idle");
  }

  function missingDbFields() {
    return !host.trim() || !port.trim() || !database.trim() || !user.trim();
  }

  async function testConnection() {
    if (missingDbFields()) {
      toast.error("Fill in host, port, database, and username first.");
      return;
    }
    setConn("testing");
    const toastId = toast.loading("Testing database connection…");
    try {
      const { res, data } = await postJson("/api/setup/test", dbPayload(), TEST_TIMEOUT_MS);
      if (res.ok && data?.ok) {
        setConn("ok");
        toast.success("Connection successful — you can now create the super administrator.", {
          id: toastId,
        });
      } else {
        setConn("fail");
        toast.error(data?.error ?? "Could not connect with these details.", { id: toastId });
      }
    } catch (err) {
      setConn("fail");
      const aborted = err instanceof DOMException && err.name === "AbortError";
      toast.error(
        aborted
          ? "The connection timed out. Check the host, port, and that the database is reachable."
          : "Network error while contacting the server.",
        { id: toastId },
      );
    }
  }

  async function completeSetup() {
    if (conn !== "ok") {
      toast.error("Test the database connection first.");
      return;
    }
    if (!adminName.trim() || !adminEmail.trim() || adminPassword.length < 12) {
      toast.error("Enter the admin's name, email, and a password of at least 12 characters.");
      return;
    }
    setBusy(true);
    const toastId = toast.loading("Creating the super administrator…");
    try {
      const { res, data } = await postJson(
        "/api/setup",
        { ...dbPayload(), admin: { email: adminEmail, fullName: adminName, password: adminPassword } },
        TEST_TIMEOUT_MS,
      );
      if (!res.ok) {
        toast.error(data?.error ?? "Setup failed. Check the details and try again.", { id: toastId });
        return;
      }
      toast.success("Setup complete. Redirecting to sign in…", { id: toastId });
      router.push("/login");
    } catch {
      toast.error("Network error while contacting the server.", { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  // Overall first-run progress: DB step verified = 50%, finishing = 90%.
  const progress = busy ? 90 : conn === "ok" ? 50 : conn === "testing" ? 25 : 0;

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 520 }}>
        <h1>Set up QMS Analytics</h1>
        <p className="sub">
          First-time setup. Connect the application database, confirm it works,
          then create the first super administrator. This screen closes
          automatically once setup is complete.
        </p>

        <Progress value={progress} className="w-full" style={{ marginTop: 4, marginBottom: 4 }}>
          <ProgressLabel>Setup progress</ProgressLabel>
          <ProgressValue />
        </Progress>

        <div className="section-title" style={{ marginTop: 8 }}>Step 1 · Application database</div>

        <div className="field">
          <label htmlFor="engine">Database engine</label>
          <select id="engine" value={engine} onChange={(e) => onEngineChange(e.target.value)}>
            {engines.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="host">Host</label>
            <input id="host" value={host} placeholder="10.0.0.11"
              onChange={(e) => onDbFieldChange(setHost)(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="port">Port</label>
            <input id="port" inputMode="numeric" value={port}
              onChange={(e) => onDbFieldChange(setPort)(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="database">Database name</label>
          <input id="database" value={database} placeholder="appdb"
            onChange={(e) => onDbFieldChange(setDatabase)(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="dbuser">Username</label>
            <input id="dbuser" autoComplete="off" value={user}
              onChange={(e) => onDbFieldChange(setUser)(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="dbpass">Password</label>
            <input id="dbpass" type="password" autoComplete="off" value={password}
              onChange={(e) => onDbFieldChange(setPassword)(e.target.value)} />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "4px 2px 4px" }}>
          <input type="checkbox" checked={ssl}
            onChange={(e) => onDbFieldChange(setSsl)(e.target.checked)} />
          Require TLS to the database
        </label>

        <button className="btn secondary" onClick={testConnection} disabled={conn === "testing"}
          style={{ width: "100%", marginTop: 4 }}>
          {conn === "testing" ? "Testing…" : conn === "ok" ? "✓ Connection verified — test again" : "Test connection"}
        </button>

        <div className="section-title" style={{ marginTop: 20, opacity: conn === "ok" ? 1 : 0.45 }}>
          Step 2 · Super administrator
        </div>

        <fieldset disabled={conn !== "ok"} style={{ border: 0, padding: 0, margin: 0, opacity: conn === "ok" ? 1 : 0.45 }}>
          <div className="field">
            <label htmlFor="adminName">Full name</label>
            <input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="adminEmail">Email</label>
            <input id="adminEmail" type="email" autoComplete="off" value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="adminPassword">Password</label>
            <input id="adminPassword" type="password" autoComplete="new-password" value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)} />
            <span className="muted" style={{ fontSize: 11 }}>At least 12 characters.</span>
          </div>

          <button className="btn" onClick={completeSetup} disabled={busy || conn !== "ok"}
            style={{ width: "100%", marginTop: 10 }}>
            {busy ? "Setting up…" : "Create super admin & finish"}
          </button>
        </fieldset>
      </div>
    </div>
  );
}
