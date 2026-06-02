import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createMessagingWebhook } from "@/lib/unipile";
import { getAppBaseUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-to-server callback from Unipile after the barber finishes hosted auth.
// We identify the barber via `name` (we passed barber.id), store the account id,
// and register the messaging webhook for that account.
export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const status = String(body?.status ?? "");
    const accountId: string | undefined = body?.account_id;
    const barberId: string | undefined = body?.name;

    if (status.toUpperCase().includes("SUCCESS") && accountId && barberId) {
      const barber = await prisma.barber.findUnique({ where: { id: barberId } });
      if (barber) {
        await prisma.barber.update({
          where: { id: barberId },
          data: { instagramAccountId: accountId },
        });
        try {
          await createMessagingWebhook({
            requestUrl: `${getAppBaseUrl(req)}/api/unipile/webhook`,
            accountId,
            name: `barberai-${barberId}`,
          });
        } catch (e) {
          // Non-fatal: the account is connected even if webhook registration fails.
          console.error("[instagram/notify] webhook registration failed:", e);
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[instagram/notify] error:", err);
    return NextResponse.json({ ok: true });
  }
}
