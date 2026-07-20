// lib/reports/mailer.ts
// -----------------------------------------------------------------------------
// Outbound email for scheduled/one-off reports, over authenticated SMTP + TLS.
//
// Design constraints (a bank has to deem this safe to run):
//   * TLS ALWAYS. On the submission port (587) STARTTLS is forced (requireTLS),
//     on 465 the socket is implicit TLS. A downgrade to cleartext is refused.
//   * The server certificate is VERIFIED by default (rejectUnauthorized). Only a
//     deliberate SMTP_TLS_REJECT_UNAUTHORIZED=false (e.g. an internal relay with
//     a private CA) relaxes it, and even then you should instead paste the CA in
//     SMTP_TLS_CA so verification stays on.
//   * Credentials come from the environment only — never persisted, never logged.
//   * FAIL CLOSED: with no SMTP_HOST/SMTP_FROM configured, isMailConfigured() is
//     false and callers skip email rather than crash. Reports are still generated
//     and shared in-app; email is purely additive.
//
// Works with Microsoft 365 (host smtp.office365.com, port 587) and any standard
// SMTP relay. It does NOT store a mailbox password anywhere but the env.
// -----------------------------------------------------------------------------
import nodemailer, { type Transporter } from "nodemailer";

export interface MailerConfig {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465); false = STARTTLS (587)
  user?: string;
  pass?: string;
  from: string;
}

/** Read + validate the SMTP config from the environment. null = not configured. */
export function mailerConfig(): MailerConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = (process.env.SMTP_FROM || process.env.SMTP_USER)?.trim();
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? 587) || 587;
  // Implicit TLS on 465; STARTTLS everywhere else. An explicit SMTP_SECURE wins.
  const secure =
    process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === "true" : port === 465;
  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from,
  };
}

export function isMailConfigured(): boolean {
  return mailerConfig() !== null;
}

// Cached transporter. `undefined` = not built yet, `null` = built but no config.
let _transport: Transporter | null | undefined;

function transporter(): Transporter | null {
  if (_transport !== undefined) return _transport;
  const cfg = mailerConfig();
  if (!cfg) {
    _transport = null;
    return null;
  }
  _transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    // Force STARTTLS when not on an implicit-TLS port: no cleartext fallback.
    requireTLS: !cfg.secure,
    tls: {
      minVersion: "TLSv1.2",
      // Verify the server cert unless explicitly told not to. If you have a
      // private CA, paste it in SMTP_TLS_CA and leave verification ON.
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
      ca: process.env.SMTP_TLS_CA?.trim() || undefined,
    },
  });
  return _transport;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailArgs {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
}

/**
 * Send one message. Throws a clear error if email isn't configured (callers on
 * the background cron path swallow it; the interactive "send test" surfaces it).
 */
export async function sendMail(args: SendMailArgs): Promise<void> {
  const t = transporter();
  const cfg = mailerConfig();
  if (!t || !cfg) {
    throw new Error("Email is not configured (set SMTP_HOST and SMTP_FROM in the environment).");
  }
  const to = normalizeEmails(args.to);
  if (to.length === 0) throw new Error("No valid recipient addresses.");
  await t.sendMail({
    from: cfg.from,
    to,
    subject: args.subject,
    text: args.text,
    html: args.html,
    attachments: args.attachments,
    replyTo: args.replyTo,
  });
}

/** Prove the SMTP server accepts our connection + credentials (for a health check). */
export async function verifyMailer(): Promise<void> {
  const t = transporter();
  if (!t) throw new Error("Email is not configured.");
  await t.verify();
}

// A conservative address check — good enough to reject typos/injection, not a
// full RFC 5322 parser. Also strips CR/LF so a crafted address can't inject
// extra SMTP headers.
const EMAIL_RE = /^[^\s@"']+@[^\s@"']+\.[^\s@"']+$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 320 && !/[\r\n]/.test(v) && EMAIL_RE.test(v);
}

/** Lower-case, de-dupe, and drop anything that isn't a valid address. */
export function normalizeEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim().toLowerCase();
    if (isValidEmail(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
