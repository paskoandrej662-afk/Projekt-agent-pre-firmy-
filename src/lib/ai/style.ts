import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getAnthropic } from "@/lib/anthropic";

const STYLE_TOOL: Anthropic.Tool = {
  name: "describe_style",
  description:
    "Zhrň ŠTÝL PÍSANIA barbera (tón, formálnosť, emoji, pozdravy/rozlúčky). Nezahŕňaj ceny ani fakty.",
  input_schema: {
    type: "object",
    properties: {
      style_summary: {
        type: "string",
        description: "Stručný slovenský popis štýlu písania (2–4 vety). Iba AKO píše, nie ceny/fakty.",
      },
      formal: { type: "boolean", description: "true ak vyká/je formálny, false ak tyká/je neformálny." },
      emojiLevel: {
        type: "string",
        enum: ["none", "low", "medium", "high"],
        description: "Miera používania emoji.",
      },
      greetings: { type: "array", items: { type: "string" }, description: "Typické pozdravy." },
      closings: { type: "array", items: { type: "string" }, description: "Typické rozlúčky." },
    },
    required: ["style_summary", "formal", "emojiLevel", "greetings", "closings"],
  },
};

export type LearnedStyle = {
  aiStyle: string;
  aiTonePrefs: { formal: boolean; emojiLevel: string; greetings: string[]; closings: string[] };
};

/** Summarize the barber's writing STYLE only (never prices/facts) from sent messages. */
export async function summarizeStyle(sentMessages: string[]): Promise<LearnedStyle> {
  const sample = sentMessages
    .slice(0, 100)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const res = await getAnthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system:
      "Si expert na analýzu štýlu písania. Dostaneš staré správy, ktoré barber poslal zákazníkom. " +
      "Zhrň IBA jeho štýl písania (tón, formálnosť, emoji, typické pozdravy a rozlúčky) — NIKDY nezahŕňaj " +
      "ceny, služby ani konkrétne fakty. Výstup je po slovensky. Vždy zavolaj nástroj describe_style.",
    tools: [STYLE_TOOL],
    tool_choice: { type: "tool", name: "describe_style" },
    messages: [{ role: "user", content: `Staré správy barbera:\n\n${sample}` }],
  });

  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("AI nevrátila popis štýlu.");

  const input = block.input as Partial<LearnedStyle["aiTonePrefs"]> & { style_summary?: string };
  return {
    aiStyle: typeof input.style_summary === "string" ? input.style_summary : "",
    aiTonePrefs: {
      formal: input.formal === true,
      emojiLevel: typeof input.emojiLevel === "string" ? input.emojiLevel : "low",
      greetings: Array.isArray(input.greetings) ? input.greetings : [],
      closings: Array.isArray(input.closings) ? input.closings : [],
    },
  };
}
