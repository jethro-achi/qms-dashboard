// lib/reports/email-report.ts
// Compose the email that carries a generated report: a subject, a short body,
// and a "Yours sincerely, {name} — {role}" signature. The signature name/role
// come from the schedule's OWNER (the person the report is sent on behalf of),
// with the role rendered exactly as the app shows it, e.g. "Nakawa Branch
// Operations" for a Branch-Ops user (see rbac.roleDescription).
import type { ReportFormat } from "./format";

/** First name from a full name ("Jethro Achelam" -> "Jethro"). */
export function firstName(fullName: string): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Best-effort first name from an email local-part, for external recipients we
 * have no system name for ("jachelam@x" -> "Jachelam"). Returns "" when nothing
 * usable can be derived (caller falls back to "colleague").
 */
export function greetingFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").split(/[._+\-]/)[0].replace(/[^a-zA-Z]/g, "");
  return local ? local.charAt(0).toUpperCase() + local.slice(1).toLowerCase() : "";
}

/** Escape a value for safe interpolation into the HTML body. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ReportEmailInput {
  reportTitle: string; // e.g. "Monthly Queue Management Report"
  periodLabel: string; // e.g. "June 2026"
  scopeLabel: string; // e.g. "All branches" / "Nakawa"
  senderName: string; // the schedule owner's full name
  senderRole: string; // roleDescription(owner) — e.g. "Nakawa Branch Operations"
  scheduleName?: string | null;
  format: ReportFormat;
  note?: string | null; // optional free-text intro the user typed on the schedule
  recipientName?: string | null; // first name for the greeting; falls back to "colleague"
}

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
}

export function composeReportEmail(input: ReportEmailInput): ComposedEmail {
  const subject = `${input.reportTitle}: ${input.periodLabel}`;
  const fmt = input.format.toUpperCase();
  const note = input.note?.trim();
  const greetName = input.recipientName?.trim() || "colleague";

  const textLines = [
    `Dear ${greetName},`,
    "",
    `Please find attached the ${input.reportTitle} for ${input.periodLabel} (${input.scopeLabel}), in ${fmt} format.`,
  ];
  if (note) {
    textLines.push("", note);
  }
  textLines.push(
    "",
    "This report was generated automatically by the QMS Analytics Dashboard.",
    "",
    "Yours sincerely,",
    input.senderName,
    input.senderRole,
  );
  const text = textLines.join("\n");

  const noteHtml = note ? `<p style="margin:0 0 16px">${esc(note).replace(/\n/g, "<br>")}</p>` : "";
  const html = `<!-- QMS report email -->
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;line-height:1.5">
  <p style="margin:0 0 16px">Dear ${esc(greetName)},</p>
  <p style="margin:0 0 16px">
    Please find attached the <strong>${esc(input.reportTitle)}</strong> for
    <strong>${esc(input.periodLabel)}</strong> (${esc(input.scopeLabel)}), in ${esc(fmt)} format.
  </p>
  ${noteHtml}
  <p style="margin:0 0 16px;color:#555">This report was generated automatically by the QMS Analytics Dashboard.</p>
  <p style="margin:0">Yours sincerely,<br>
    <strong>${esc(input.senderName)}</strong><br>
    <span style="color:#555">${esc(input.senderRole)}</span>
  </p>
</div>`;

  return { subject, text, html };
}
