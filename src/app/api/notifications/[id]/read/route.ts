import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBarberId } from "@/lib/session";

export const runtime = "nodejs";

// Mark a notification as handled. Scoped to the session's barber (multi-tenant safe).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const barberId = getBarberId();
  if (!barberId) return NextResponse.json({ error: "Relácia vypršala." }, { status: 401 });

  const result = await prisma.notification.updateMany({
    where: { id: params.id, barberId },
    data: { read: true },
  });
  return NextResponse.json({ ok: result.count > 0 });
}
