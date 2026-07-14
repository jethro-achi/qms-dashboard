// lib/ai/assistant.ts
// The agentic loop: hand the model the question + tool schemas, execute any tool
// calls it makes against the RBAC-safe dispatcher, feed results back, and repeat
// until it answers in prose (or we hit the iteration cap). Runs entirely on the
// local model — nothing leaves the server.
import type { Principal } from "../rbac";
import { ollamaChat, type ChatMessage } from "./ollama";
import { AI_TOOLS, runTool } from "./tools";

const MAX_STEPS = 5;

const SYSTEM_PROMPT = `You are the QMS Analytics assistant for a bank/service-centre queue-management dashboard.

Your job: answer questions about queue and branch performance using ONLY the tools provided. The tools already scope every result to the branches this user is allowed to see — never claim you can see other branches.

Rules:
- Always call a tool to get real numbers. Never invent or estimate figures.
- For ANY arithmetic (differences, percentages, ratios), use the "calculate" tool rather than doing mental math.
- If you are unsure of an exact branch or service name, call "list_dimensions" first.
- Durations from tools are already in minutes. Ticket counts are whole numbers.
- Keep answers short and concrete: lead with the number, then one line of context. Use plain text (no markdown tables).
- If a tool returns an error or empty data, say so plainly instead of guessing.
- Only answer questions about this dashboard's queue analytics. Politely decline anything else.`;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Run the assistant to completion for a conversation. `history` is the prior
 * turns (oldest first) including the latest user message.
 */
export async function runAssistant(history: Turn[], principal: Principal): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((t) => ({ role: t.role, content: t.content })),
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const { content, toolCalls } = await ollamaChat(messages, AI_TOOLS);

    if (!toolCalls.length) {
      return content.trim() || "I couldn't find an answer for that.";
    }

    // Record the assistant's tool request, then run each tool and feed results
    // back for the next step.
    messages.push({ role: "assistant", content, tool_calls: toolCalls });
    for (const call of toolCalls) {
      const result = await runTool(call.function.name, call.function.arguments ?? {}, principal);
      messages.push({ role: "tool", content: result, tool_name: call.function.name });
    }
  }

  // Ran out of steps — ask for one final prose answer with no more tools.
  const { content } = await ollamaChat(
    [...messages, { role: "user", content: "Give your best final answer now using the data above. Do not call any more tools." }],
  );
  return content.trim() || "I gathered the data but couldn't summarise it — please try rephrasing.";
}
