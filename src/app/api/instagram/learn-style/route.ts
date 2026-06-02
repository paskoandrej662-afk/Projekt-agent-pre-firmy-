import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadCurrentBarber } from "@/lib/barber";
import { listSentMessages } from "@/lib/unipile";
import { summarizeStyle } from "@/lib/ai/style";

export const runtime = "nodejs";

// (E) Learn the barber's writing style from their recent SENT Instagram messages.
export async function POST() {
  const barber = await loadCurrentBarber();
  if (!barber) return NextResponse.json({ error: "Relácia vypršala." }, { status: 401 });
  if (!barber.instagramAccountId) {
    return NextResponse.json({ error: "Najprv pripojte Instagram." }, { status: 400 });
  }

  try {
    const sent = await listSentMessages(barber.instagramAccountId, 100);
    const texts = sent
      .map((m) => m.text)
      .filter((t): t is string => !!t && t.trim().length > 0);
    if (texts.length === 0) {
      return NextResponse.json(
        { error: "Nenašli sme žiadne odoslané správy na Instagrame." },
        { status: 404 },
      );
    }

    const learned = await summarizeStyle(texts);
    await prisma.barber.update({
      where: { id: barber.id },
      data: {
        aiStyle: learned.aiStyle,
        aiTonePrefs: learned.aiTonePrefs as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ ok: true, aiStyle: learned.aiStyle, count: texts.length });
  } catch (err) {
    console.error("[instagram/learn-style] error:", err);
    return NextResponse.json(
      { error: "Nepodarilo sa načítať štýl z Instagramu. Skúste to neskôr." },
      { status: 502 },
    );
  }
}
