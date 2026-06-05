import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendReply, UnipileError, type SendStrategy } from "@/lib/unipile";
import { priceGuard, HOLDING_LINE_ENABLED, HOLDING_LINE_TEXT } from "@/lib/ai/reply";
import { runAssistant } from "@/lib/ai/agent";
import type { BookingContext } from "@/lib/booking/actions";

const HISTORY_LIMIT = 15;

// Concise, single-line error description (no stack-trace spam).
function describeError(err: unknown): string {
  if (err instanceof UnipileError) {
    return `Unipile ${err.status}${err.body ? ` ${String(err.body).slice(0, 200)}` : ""}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

type SendResult =
  | { ok: true; messageId: string | null; chatId: string | null; strategy: SendStrategy | "none" }
  | { ok: false; error: string };

// Send via Unipile (when an account is linked). Never throws. Persists the
// canonical chat id back to the conversation so future replies go direct.
async function trySend(
  conversationId: string,
  accountId: string | null,
  chatId: string | null,
  attendeeProviderId: string | null,
  publicIdentifier: string | null,
  text: string,
): Promise<SendResult> {
  if (!accountId) {
    // No connected Instagram (e.g. local test) — record as "sent" so the AI message is saved.
    return { ok: true, messageId: null, chatId, strategy: "none" };
  }
  if (!chatId && !attendeeProviderId && !publicIdentifier) {
    return { ok: false, error: "Chýba chat aj identifikátor zákazníka (attendee/handle)." };
  }
  try {
    const res = await sendReply({ accountId, chatId, attendeeProviderId, publicIdentifier, text });
    if (res.chatId && res.chatId !== chatId) {
      await prisma.conversation
        .update({ where: { id: conversationId }, data: { externalChatId: res.chatId } })
        .catch(() => {});
    }
    return { ok: true, messageId: res.messageId, chatId: res.chatId, strategy: res.strategy };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function notify(
  barberId: string,
  conversationId: string,
  type: NotificationType,
  message: string,
  draftReply: string | null,
): Promise<void> {
  await prisma.notification
    .create({ data: { barberId, conversationId, type, message, draftReply } })
    .catch((e) => console.warn(`[messaging] notifikácia neuložená: ${e?.code ?? e}`));
}

/**
 * Core of step (C)/(D)/(F): generate a reply in the barber's style, enforce
 * anti-hallucination, then SEND it (confident) or stay silent + notify the barber.
 * Never throws — every failure becomes a barber notification (nothing is lost).
 */
export async function processIncomingMessage(conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      barber: { include: { services: { where: { active: true }, orderBy: { id: "asc" } } } },
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });
  if (!conversation) return;
  if (conversation.controlledBy !== "AI") return; // barber has taken over

  const barber = conversation.barber;
  const services = barber.services;
  const handle = conversation.customerHandle;
  const history = conversation.messages
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ sender: m.sender, text: m.text }));
  const allowedPrices = services.map((s) => Number(s.priceEur.toString()));

  const send = (text: string) =>
    trySend(
      conversation.id,
      barber.instagramAccountId,
      conversation.externalChatId,
      conversation.attendeeProviderId,
      conversation.customerHandle, // @handle — fallback identifier for the profile lookup
      text,
    );

  // Booking context (Step 3): the AI may read availability + book/reschedule/cancel
  // through live calendar tools. Connected iff the barber stored Google tokens.
  const calendarConnected = barber.googleCalendarTokens != null;
  const ctx: BookingContext = {
    barber: {
      id: barber.id,
      bufferMin: barber.bufferMin,
      workingHours: barber.workingHours,
      googleCalendarTokens: barber.googleCalendarTokens,
    },
    services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin })),
    conversation: {
      id: conversation.id,
      customerHandle: conversation.customerHandle,
      customerName: conversation.customerName,
    },
    now: new Date(),
  };

  // 1) Generate the draft (tool-use loop when the calendar is connected).
  let draft;
  let writeOccurred = false;
  try {
    const result = await runAssistant({ barberFacts: barber, services, history, ctx, calendarConnected });
    draft = result.draft;
    writeOccurred = result.writeOccurred;
  } catch (err) {
    console.warn(`[messaging] AI generovanie zlyhalo (@${handle}): ${describeError(err)}`);
    await notify(
      barber.id,
      conversation.id,
      "AI_ERROR",
      `Nepodarilo sa vygenerovať odpoveď pre @${handle}. Odpovedzte, prosím, ručne.`,
      null,
    );
    return;
  }

  // 2a) A booking write (book/reschedule/cancel) already happened → the customer
  // MUST get the confirmation, regardless of the model's self-reported confidence.
  if (writeOccurred) {
    const text = draft.reply.trim() || "Hotovo, termín je zapísaný ✅";
    const sent = await send(text);
    if (sent.ok) {
      if (sent.strategy !== "none") {
        console.log(`[messaging] potvrdenie rezervácie odoslané (@${handle}) stratégiou=${sent.strategy}`);
      }
      await prisma.message
        .create({ data: { conversationId: conversation.id, sender: "AI", text, externalId: sent.messageId } })
        .catch((e) => console.warn(`[messaging] AI správa neuložená: ${e?.code ?? e}`));
    } else {
      // Booking is done but we couldn't deliver the confirmation → hand it to the barber.
      console.warn(`[messaging] potvrdenie rezervácie neodoslané (@${handle}): ${sent.error}`);
      await notify(
        barber.id,
        conversation.id,
        "AI_ERROR",
        `Rezervácia pre @${handle} je zapísaná, ale potvrdenie sa nepodarilo odoslať. Pošlite ho, prosím, ručne.`,
        text,
      );
    }
    return;
  }

  // 2b) No write happened → Step 2 confidence gate + defensive price guard.
  const priceIssue = priceGuard(draft.reply, allowedPrices);
  const confident = draft.confident && !priceIssue && draft.reply.trim().length > 0;
  const needsBarber = draft.needs_barber || priceIssue || !confident;

  // 3a) Confident → send the reply.
  if (confident && !needsBarber) {
    const sent = await send(draft.reply);
    if (sent.ok) {
      if (sent.strategy !== "none") {
        console.log(`[messaging] odpoveď odoslaná (@${handle}) stratégiou=${sent.strategy}`);
      }
      await prisma.message
        .create({
          data: { conversationId: conversation.id, sender: "AI", text: draft.reply, externalId: sent.messageId },
        })
        .catch((e) => console.warn(`[messaging] AI správa neuložená: ${e?.code ?? e}`));
    } else {
      // FALLBACK: sending failed → hand the drafted reply to the barber (don't lose it).
      console.warn(`[messaging] odoslanie odpovede zlyhalo (@${handle}): ${sent.error}`);
      await notify(
        barber.id,
        conversation.id,
        "AI_ERROR",
        `Odpoveď sa nepodarilo odoslať zákazníkovi @${handle}. Pošlite ju, prosím, ručne.`,
        draft.reply,
      );
    }
    return;
  }

  // 3b) Not confident → do NOT send the AI's answer. Notify the barber with the draft.
  await notify(
    barber.id,
    conversation.id,
    priceIssue ? "PRICE_GUARD" : "AI_UNSURE",
    `AI si nebola istá pri správe od @${handle}. Dôvod: ${
      draft.reason || (priceIssue ? "cena nesedí so službami" : "nízka istota")
    }`,
    draft.reply || null,
  );

  // Optionally send a safe, fact-free holding line so the customer isn't ignored.
  if (HOLDING_LINE_ENABLED) {
    const sent = await send(HOLDING_LINE_TEXT);
    if (sent.ok) {
      if (sent.strategy !== "none") {
        console.log(`[messaging] holding line odoslaná (@${handle}) stratégiou=${sent.strategy}`);
      }
      await prisma.message
        .create({
          data: { conversationId: conversation.id, sender: "AI", text: HOLDING_LINE_TEXT, externalId: sent.messageId },
        })
        .catch(() => {});
    } else {
      // Barber is already notified with the draft — just log cleanly.
      console.warn(`[messaging] holding line neodoslaná (@${handle}): ${sent.error}`);
    }
  }
}
