// Step 3 reply engine. Extends the Step 2 single-shot draft into a tool-use loop:
// the AI can check availability and book / reschedule / cancel via the calendar
// tools, then finishes by calling draft_reply (the terminal tool whose `reply` we
// actually send). All anti-hallucination guarantees from Step 2 stay: the AI only
// learns availability from tool results, never invents times, and the final reply
// still passes through the confidence gate + priceGuard in messaging.ts.

import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getAnthropic } from "@/lib/anthropic";
import {
  buildBookingBlock,
  buildSystemBlocks,
  type BarberFacts,
  type ServiceFact,
} from "./prompts";
import {
  DRAFT_TOOL,
  coerceDraft,
  toMessages,
  type DraftReply,
  type HistoryMessage,
} from "./reply";
import {
  bookAppointmentAction,
  cancelAppointmentAction,
  checkAvailabilityAction,
  getActiveBooking,
  rescheduleAppointmentAction,
  type BookingContext,
} from "@/lib/booking/actions";
import { formatBratislava } from "@/lib/booking/timezone";

// Upper bound on AI↔tool round-trips (e.g. check → book → confirm). The final
// step forces draft_reply so we always end with a sendable reply.
const MAX_STEPS = 6;

const CALENDAR_TOOLS: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Zisti VOĽNÉ termíny barbera v konkrétny deň. Vráti zoznam voľných začiatkov (HH:MM). Nikdy nehádaj voľné časy — vždy over týmto nástrojom.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Deň vo formáte RRRR-MM-DD (slovenský čas)." },
        service_name: { type: "string", description: "Názov služby (kvôli dĺžke termínu). Nepovinné." },
      },
      required: ["date"],
    },
  },
  {
    name: "book_appointment",
    description:
      "Rezervuj termín do kalendára. Volaj LEN keď ste sa so zákazníkom dohodli na konkrétnej službe aj čase. Systém ešte raz naživo overí, či je voľné.",
    input_schema: {
      type: "object",
      properties: {
        service_name: { type: "string", description: "Názov služby (presne ako v ponuke)." },
        date: { type: "string", description: "Deň RRRR-MM-DD." },
        time: { type: "string", description: "Začiatok HH:MM (slovenský čas)." },
      },
      required: ["service_name", "date", "time"],
    },
  },
  {
    name: "reschedule_appointment",
    description: "Presuň EXISTUJÚCU rezerváciu tohto zákazníka na nový čas. Starú zruší až po overení nového termínu.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Nový deň RRRR-MM-DD." },
        time: { type: "string", description: "Nový začiatok HH:MM." },
      },
      required: ["date", "time"],
    },
  },
  {
    name: "cancel_appointment",
    description: "Zruš rezerváciu tohto zákazníka (zmaže udalosť z kalendára).",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

export type AssistantResult = {
  draft: DraftReply;
  /** A booking write (book/reschedule/cancel) succeeded this turn → must reach the customer. */
  writeOccurred: boolean;
};

async function executeTool(
  name: string,
  input: any,
  ctx: BookingContext,
): Promise<{ output: { ok: boolean; [k: string]: unknown }; isWrite: boolean }> {
  switch (name) {
    case "check_availability":
      return { output: await checkAvailabilityAction(ctx, input ?? {}), isWrite: false };
    case "book_appointment":
      return { output: await bookAppointmentAction(ctx, input ?? {}), isWrite: true };
    case "reschedule_appointment":
      return { output: await rescheduleAppointmentAction(ctx, input ?? {}), isWrite: true };
    case "cancel_appointment":
      return { output: await cancelAppointmentAction(ctx), isWrite: true };
    default:
      return { output: { ok: false, reason: "unknown_tool" }, isWrite: false };
  }
}

const EMPTY_DRAFT: DraftReply = {
  reply: "",
  confident: false,
  needs_barber: true,
  reason: "Žiadna správa zákazníka.",
};

/**
 * Generate the reply, using calendar tools when connected. Returns the terminal
 * draft plus whether a booking write happened (so messaging always delivers a
 * confirmation, even if the model under-reports confidence).
 */
export async function runAssistant(opts: {
  barberFacts: BarberFacts;
  services: ServiceFact[];
  history: HistoryMessage[];
  ctx: BookingContext;
  calendarConnected: boolean;
}): Promise<AssistantResult> {
  const { barberFacts, services, history, ctx, calendarConnected } = opts;

  const messages = toMessages(history);
  if (messages.length === 0) return { draft: EMPTY_DRAFT, writeOccurred: false };

  // Per-conversation booking context (now + this customer's active booking).
  const existing = calendarConnected ? await getActiveBooking(ctx.conversation.id) : null;
  const existingBookingHuman = existing
    ? `${existing.service.name}, ${formatBratislava(existing.startTime)}`
    : null;
  const bookingBlock = buildBookingBlock({
    nowHuman: formatBratislava(ctx.now),
    calendarConnected,
    existingBookingHuman,
  });
  const system = buildSystemBlocks(barberFacts, services, bookingBlock);

  const tools = calendarConnected ? [...CALENDAR_TOOLS, DRAFT_TOOL] : [DRAFT_TOOL];
  const anthropic = getAnthropic();
  let writeOccurred = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const forceDraft = !calendarConnected || step === MAX_STEPS - 1;
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      tools,
      tool_choice: forceDraft ? { type: "tool", name: "draft_reply" } : { type: "auto" },
      messages,
    });

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // Terminal: the model produced the final reply.
    const draftBlock = toolUses.find((b) => b.name === "draft_reply");
    if (draftBlock) return { draft: coerceDraft(draftBlock.input as Partial<DraftReply>), writeOccurred };

    // Model answered in plain text without any tool → nudge it to call draft_reply.
    if (toolUses.length === 0) {
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: "Zavolaj nástroj draft_reply s finálnou odpoveďou zákazníkovi." });
      continue;
    }

    // Execute the requested calendar tools, feed results back, loop.
    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const { output, isWrite } = await executeTool(tu.name, tu.input, ctx);
      if (isWrite && output.ok) writeOccurred = true;
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Should be unreachable (last step forces draft_reply); fail safe to the barber.
  return {
    draft: { reply: "", confident: false, needs_barber: true, reason: "AI nedokončila odpoveď." },
    writeOccurred,
  };
}
