import { NextResponse } from "next/server";
import { Prisma, type Barber } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getBarberId, setBarberId } from "@/lib/session";
import {
  step1Schema,
  step2Schema,
  step3Schema,
  step5Schema,
  zodErrorMap,
} from "@/lib/validation";

// Prisma requires the Node.js runtime (not Edge).
export const runtime = "nodejs";

// ── Response helpers ─────────────────────────────────────────────────────────
function jsonOk(barber: Pick<Barber, "onboardingStep" | "onboardingComplete">) {
  return NextResponse.json({
    ok: true,
    onboardingStep: barber.onboardingStep,
    onboardingComplete: barber.onboardingComplete,
  });
}

function jsonValidation(error: ZodError) {
  return NextResponse.json({ errors: zodErrorMap(error) }, { status: 400 });
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// ── Step handlers ────────────────────────────────────────────────────────────

// Step 1 creates the barber on first run (and sets the session cookie), or
// updates it when revisited/edited. Progress is never moved backwards.
async function handleStep1(body: unknown) {
  const parsed = step1Schema.safeParse(body);
  if (!parsed.success) return jsonValidation(parsed.error);

  const id = getBarberId();
  try {
    if (id) {
      const existing = await prisma.barber.findUnique({ where: { id } });
      if (existing) {
        const updated = await prisma.barber.update({
          where: { id },
          data: { ...parsed.data, onboardingStep: Math.max(existing.onboardingStep, 2) },
        });
        return jsonOk(updated);
      }
      // Stale cookie (e.g. DB reset) — fall through and create a fresh barber.
    }
    const created = await prisma.barber.create({
      data: { ...parsed.data, onboardingStep: 2 },
    });
    setBarberId(created.id);
    return jsonOk(created);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { errors: { email: "Tento e-mail je už zaregistrovaný." } },
        { status: 409 },
      );
    }
    throw e;
  }
}

async function handleStep2(barber: Barber, body: unknown) {
  const parsed = step2Schema.safeParse(body);
  if (!parsed.success) return jsonValidation(parsed.error);

  const updated = await prisma.barber.update({
    where: { id: barber.id },
    data: {
      workingHours: parsed.data.workingHours as Prisma.InputJsonValue,
      bufferMin: parsed.data.bufferMin,
      onboardingStep: Math.max(barber.onboardingStep, 3),
    },
  });
  return jsonOk(updated);
}

async function handleStep3(barber: Barber, body: unknown) {
  const parsed = step3Schema.safeParse(body);
  if (!parsed.success) return jsonValidation(parsed.error);

  // Replace the catalogue atomically. This is safe while no bookings reference
  // services yet (this foundation step). Once bookings exist, switch to a soft
  // sync (update existing / insert new / deactivate removed) to preserve FKs.
  await prisma.$transaction([
    prisma.service.deleteMany({ where: { barberId: barber.id } }),
    prisma.service.createMany({
      data: parsed.data.services.map((s) => ({
        barberId: barber.id,
        name: s.name,
        durationMin: s.durationMin,
        priceEur: s.priceEur.toFixed(2),
        active: true,
      })),
    }),
  ]);

  const updated = await prisma.barber.update({
    where: { id: barber.id },
    data: { onboardingStep: Math.max(barber.onboardingStep, 4) },
  });
  return jsonOk(updated);
}

// Step 4 is the Instagram placeholder — nothing to persist yet, just advance.
async function handleStep4(barber: Barber) {
  const updated = await prisma.barber.update({
    where: { id: barber.id },
    data: { onboardingStep: Math.max(barber.onboardingStep, 5) },
  });
  return jsonOk(updated);
}

async function handleStep5(barber: Barber, body: unknown) {
  const parsed = step5Schema.safeParse(body);
  if (!parsed.success) return jsonValidation(parsed.error);

  const updated = await prisma.barber.update({
    where: { id: barber.id },
    data: {
      aiStyle: parsed.data.aiStyle ? parsed.data.aiStyle : null,
      onboardingStep: 5,
      onboardingComplete: true,
    },
  });
  return jsonOk(updated);
}

// ── Router ───────────────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: { step: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Step 1 may run before any barber exists.
  if (params.step === "1") return handleStep1(body);

  // Steps 2–5 require an established session.
  const id = getBarberId();
  if (!id) return jsonError("Relácia vypršala. Začnite, prosím, znova.", 401);
  const barber = await prisma.barber.findUnique({ where: { id } });
  if (!barber) return jsonError("Profil sa nenašiel. Začnite, prosím, znova.", 404);

  switch (params.step) {
    case "2":
      return handleStep2(barber, body);
    case "3":
      return handleStep3(barber, body);
    case "4":
      return handleStep4(barber);
    case "5":
      return handleStep5(barber, body);
    default:
      return jsonError("Neznámy krok.", 404);
  }
}
