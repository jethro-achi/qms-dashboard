// app/api/assistant/route.ts
// Ask the local AI assistant a question. Available to dashboard admins and
// branch ops only — the super admin is excluded (matching reports/messages).
// The model runs locally (Ollama) and can only read data through the caller's
// own branch-scoped principal.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser, toPrincipal } from "@/lib/session";
import { runAssistant, type Turn } from "@/lib/ai/assistant";
import { AssistantUnavailableError } from "@/lib/ai/ollama";
import { assistantEnabled } from "@/lib/ai/enabled";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(req: Request) {
  // Feature switch, checked BEFORE anything else: when the assistant is off the
  // endpoint behaves as if it doesn't exist. Hiding the launcher in the UI is not
  // enough on its own — this is the fail-closed server-side gate.
  if (!assistantEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Assistant is for dashboard users, not the super admin.
  if (user.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  const turns: Turn[] = parsed.data.messages.map((m) => ({ role: m.role, content: m.content }));
  const lastUser = [...turns].reverse().find((m) => m.role === "user");

  try {
    const reply = await runAssistant(turns, toPrincipal(user));
    // Record the question (not the full answer) in the tamper-evident audit log.
    await auditFromRequest(req, user.id, "ASSISTANT_QUERY", "assistant", {
      question: lastUser?.content.slice(0, 500) ?? "",
      turns: parsed.data.messages.length,
    });
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof AssistantUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: "The assistant hit an error. Please try again." }, { status: 500 });
  }
}
