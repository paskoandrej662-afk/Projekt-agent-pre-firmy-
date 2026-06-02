import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getAnthropic } from "@/lib/anthropic";
import { buildSystemBlocks, type BarberFacts, type ServiceFact } from "./prompts";

// Holding line: a generic, fact-free line we may send while the barber is looped
// in. Configurable, default ON (set AI_HOLDING_LINE=off to disable).
export const HOLDING_LINE_ENABLED = (process.env.AI_HOLDING_LINE ?? "on").toLowerCase() !== "off";
export const HOLDING_LINE_TEXT = "Mrknem na to a ozvem sa ti čo najskôr 👍";

// Forced-tool-use gives us a reliable JSON wrapper (no fragile parsing).
const DRAFT_TOOL: Anthropic.Tool = {
  name: "draft_reply",
  description: "Navrhni odpoveď zákazníkovi a urči, či je AI dostatočne istá.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Odpoveď zákazníkovi v štýle barbera." },
      confident: {
        type: "boolean",
        description: "true LEN ak je odpoveď úplne podložená faktami.",
      },
      needs_barber: {
        type: "boolean",
        description: "true ak treba zásah barbera (termín, info mimo faktov).",
      },
      reason: { type: "string", description: "Krátke zdôvodnenie po slovensky pre barbera." },
    },
    required: ["reply", "confident", "needs_barber", "reason"],
  },
};

export type DraftReply = {
  reply: string;
  confident: boolean;
  needs_barber: boolean;
  reason: string;
};

export type HistoryMessage = { sender: "CUSTOMER" | "AI" | "BARBER"; text: string };

function toMessages(history: HistoryMessage[]): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = history
    .filter((m) => m.text && m.text.trim().length > 0)
    .map((m) => ({ role: m.sender === "CUSTOMER" ? "user" : "assistant", content: m.text }));
  // The API requires the first message to come from the user.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

/** Generate the structured draft via Claude (forced tool use + prompt caching). */
export async function generateDraft(
  barber: BarberFacts,
  services: ServiceFact[],
  history: HistoryMessage[],
): Promise<DraftReply> {
  const messages = toMessages(history);
  if (messages.length === 0) {
    return { reply: "", confident: false, needs_barber: true, reason: "Žiadna správa zákazníka." };
  }

  const res = await getAnthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: buildSystemBlocks(barber, services),
    tools: [DRAFT_TOOL],
    tool_choice: { type: "tool", name: "draft_reply" },
    messages,
  });

  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("AI nevrátila štruktúrovanú odpoveď.");

  const input = block.input as Partial<DraftReply>;
  return {
    reply: typeof input.reply === "string" ? input.reply : "",
    confident: input.confident === true,
    needs_barber: input.needs_barber === true,
    reason: typeof input.reason === "string" ? input.reason : "",
  };
}

/**
 * PRICE/SERVICE GUARD (defensive, code-side): any € amount in the reply must
 * match a real service price. Returns true if the reply mentions a price we
 * don't have → treat as not confident and route to the barber.
 */
export function priceGuard(reply: string, allowedPrices: number[]): boolean {
  const allowed = new Set(allowedPrices.map((p) => Math.round(p * 100)));
  const re = /(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euro\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const cents = Math.round(Number(m[1].replace(",", ".")) * 100);
    if (!allowed.has(cents)) return true;
  }
  return false;
}
