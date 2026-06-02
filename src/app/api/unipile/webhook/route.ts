import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processIncomingMessage } from "@/lib/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Derive a stable customer handle from the webhook sender (prefer the @handle).
function deriveHandle(sender: any): string {
  // Instagram @handle (real payload field).
  if (typeof sender?.public_identifier === "string" && sender.public_identifier.trim()) {
    return sender.public_identifier.trim();
  }
  if (typeof sender?.attendee_public_identifier === "string" && sender.attendee_public_identifier.trim()) {
    return sender.attendee_public_identifier.trim();
  }
  const url = sender?.attendee_profile_url;
  if (typeof url === "string") {
    const m = url.match(/instagram\.com\/([^/?#]+)/i);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  if (typeof sender?.attendee_provider_id === "string" && sender.attendee_provider_id) {
    return sender.attendee_provider_id;
  }
  if (typeof sender?.attendee_name === "string" && sender.attendee_name.trim()) {
    return sender.attendee_name.trim();
  }
  return "neznámy";
}

// (B) Incoming-message webhook. Always returns 200 quickly so Unipile doesn't
// disable the endpoint; all work is guarded.
export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));

    // Log the FULL raw payload so we can see exactly which fields Unipile sends
    // (chat id, account id, sender, message id, text).
    console.log("[unipile/webhook] payload:\n" + JSON.stringify(body, null, 2));

    // We only care about new incoming messages.
    if (body?.event !== "message_received") return NextResponse.json({ ok: true });

    const accountId: string | undefined = body.account_id;
    const messageId: string | undefined = body.message_id;
    const chatId: string | undefined = body.chat_id;
    const text: string = typeof body.message === "string" ? body.message : "";
    const sender = body.sender ?? {};
    const attendeeProviderId: string | null =
      typeof sender.attendee_provider_id === "string" ? sender.attendee_provider_id : null;
    const ownProviderId = body.account_info?.user_id;

    if (!accountId || !messageId || !chatId) return NextResponse.json({ ok: true });

    // Ignore our OWN outgoing messages. Prefer the explicit is_sender flag; fall
    // back to comparing the connected account's provider id against the sender's.
    if (
      body.is_sender === true ||
      (ownProviderId && sender.attendee_provider_id && ownProviderId === sender.attendee_provider_id)
    ) {
      return NextResponse.json({ ok: true, ignored: "own_message" });
    }

    // Identify the barber by the Unipile account id.
    const barber = await prisma.barber.findFirst({ where: { instagramAccountId: accountId } });
    if (!barber) return NextResponse.json({ ok: true, ignored: "unknown_account" });

    const customerHandle = deriveHandle(sender);
    const customerName = typeof sender.attendee_name === "string" ? sender.attendee_name : null;

    // Find or create the thread; keep the chat id + attendee id fresh so we can reply.
    const conversation = await prisma.conversation.upsert({
      where: {
        barberId_customerHandle_channel: {
          barberId: barber.id,
          customerHandle,
          channel: "instagram",
        },
      },
      update: {
        externalChatId: chatId,
        attendeeProviderId: attendeeProviderId ?? undefined,
        customerName: customerName ?? undefined,
      },
      create: {
        barberId: barber.id,
        customerHandle,
        customerName,
        channel: "instagram",
        externalChatId: chatId,
        attendeeProviderId,
      },
    });

    // IDEMPOTENCY: provider message id is unique. If we've seen it, do nothing.
    try {
      await prisma.message.create({
        data: { conversationId: conversation.id, sender: "CUSTOMER", text, externalId: messageId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return NextResponse.json({ ok: true, deduped: true });
      }
      throw e;
    }

    // Generate + send/notify. Inline for MVP; fully guarded (never throws).
    await processIncomingMessage(conversation.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[unipile/webhook] error:", err);
    // Still 200 — we logged it; returning 5xx would make Unipile retry/disable.
    return NextResponse.json({ ok: true });
  }
}
