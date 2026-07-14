// lib/ai/ollama.ts
// -----------------------------------------------------------------------------
// Thin client for a LOCAL, self-hosted model served by Ollama. Deliberately NOT
// the Anthropic/OpenAI SDK: this runs on the bank's own server (CPU-only, no
// GPU), so nothing leaves the network. The model only ever sees the user's
// question and the AGGREGATED tool results — never raw ticket/customer rows.
//
// Model: a small instruction-tuned, tool-calling model (default qwen2.5:3b),
// chosen to run acceptably on CPU. Override with ASSISTANT_MODEL.
// -----------------------------------------------------------------------------

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL ?? "qwen2.5:3b";
// CPU inference is slow; give each turn a generous ceiling.
const REQUEST_TIMEOUT_MS = Number(process.env.ASSISTANT_TIMEOUT_MS ?? 120_000);

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant turns that requested tools. */
  tool_calls?: ToolCall[];
  /** Set on tool-result turns so the model can match the call. */
  tool_name?: string;
}

interface OllamaChatResponse {
  message?: { role: string; content: string; tool_calls?: ToolCall[] };
  error?: string;
}

/** Raised when the local model runtime is unreachable or errors. */
export class AssistantUnavailableError extends Error {}

/**
 * One non-streaming chat completion against the local model. Low temperature —
 * this is an analytics assistant, not a creative writer — and a bounded context
 * so a small CPU model stays responsive.
 */
export async function ollamaChat(
  messages: ChatMessage[],
  tools?: ToolSchema[],
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        messages,
        tools: tools?.length ? tools : undefined,
        stream: false,
        options: { temperature: 0.1, num_ctx: 4096 },
      }),
    });
  } catch (err) {
    throw new AssistantUnavailableError(
      (err as Error).name === "AbortError"
        ? "The assistant timed out. On a CPU-only server, try a shorter question or a smaller model."
        : "The local AI model is not reachable. Is the Ollama service running?",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A 404 from Ollama almost always means the model hasn't been pulled yet.
    if (res.status === 404) {
      throw new AssistantUnavailableError(
        `The model "${ASSISTANT_MODEL}" isn't installed. Run: ollama pull ${ASSISTANT_MODEL}`,
      );
    }
    throw new AssistantUnavailableError(`Local model error (${res.status}). ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) throw new AssistantUnavailableError(data.error);
  return {
    content: data.message?.content ?? "",
    toolCalls: data.message?.tool_calls ?? [],
  };
}
