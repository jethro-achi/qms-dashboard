// app/api/reports/mailer/test/route.ts
// Diagnostic: prove the SMTP settings work. verifyMailer() performs the real
// server handshake + auth, then one plain email is sent. Dashboard users only
// (the super admin has no Reports section). Nothing about a report here — this
// exists so you can confirm credentials before wiring up a schedule.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { sendMail, verifyMailer, isMailConfigured, isValidEmail } from "@/lib/reports/mailer";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ to: z.string().trim().email().max(320).optional() });

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN")
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  if (!isMailConfigured())
    return NextResponse.json(
      { error: "Email is not configured. Set SMTP_HOST and SMTP_FROM in .env, then rebuild the app." },
      { status: 400 },
    );

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = send to self */
  }
  const parsed = Schema.safeParse(body ?? {});
  const to = parsed.success && parsed.data.to ? parsed.data.to : user.email;
  if (!to || !isValidEmail(to))
    return NextResponse.json({ error: "No valid recipient address." }, { status: 400 });

  try {
    await verifyMailer(); // real SMTP connect + auth — the actual credential check
    await sendMail({
      to: [to],
      subject: "QMS Analytics — test email",
      text:
        `This is a test email from the QMS Analytics Dashboard, sent by ${user.name}.\n\n` +
        `If you received this, SMTP delivery is working and scheduled reports will send.`,
      html:
        `<p>This is a test email from the <strong>QMS Analytics Dashboard</strong>, sent by ${esc(user.name)}.</p>` +
        `<p>If you received this, SMTP delivery is working and scheduled reports will send.</p>`,
    });
    await auditFromRequest(req, user.id, "REPORT_EMAIL", "mailer-test", { to: 1 });
    return NextResponse.json({ ok: true, to });
  } catch (err) {
    // Surface the SMTP server's own message (e.g. auth rejected) so the operator
    // can fix the settings without digging through server logs.
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
