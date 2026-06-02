import Anthropic from "@anthropic-ai/sdk";

// Cost-effective Sonnet. Change this one constant to swap models everywhere.
export const CLAUDE_MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

/** Lazily build a singleton client (reads ANTHROPIC_API_KEY from env). */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Chýba premenná prostredia ANTHROPIC_API_KEY.");
  }
  return (client ??= new Anthropic());
}
