// lib/ai/enabled.ts
// -----------------------------------------------------------------------------
// The single on/off switch for the on-premises AI assistant.
//
// OFF by default: the local model runtime (Ollama) needs real CPU/RAM on the
// server, so a deployment without the horsepower shouldn't pay for it. Nothing
// is deleted — flip it back on when the compute is there:
//
//   1. ASSISTANT_ENABLED=true          (in .env / .env.local)
//   2. docker compose --profile assistant up -d      (starts the model runtime)
//   3. docker compose exec ollama ollama pull qwen2.5:3b   (once, if not pulled)
//
// Deliberately a tiny, dependency-free module so both server components and the
// API route can import it without pulling in the model client.
// -----------------------------------------------------------------------------

/** True only when the operator has explicitly enabled the assistant. */
export function assistantEnabled(): boolean {
  return process.env.ASSISTANT_ENABLED === "true";
}
