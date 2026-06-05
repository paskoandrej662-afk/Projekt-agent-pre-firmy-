import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBarberId } from "@/lib/session";
import { exchangeCodeForTokens } from "@/lib/google/oauth";
import { getAppBaseUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// (A) OAuth callback. Google redirects the barber's browser here with `?code=…`.
// We exchange the code for tokens (incl. a refresh token) and store them on the
// Barber. `state` must match the session cookie (CSRF protection).
export async function GET(req: Request) {
  const base = getAppBaseUrl(req);
  const fail = (why: string) => {
    console.error(`[google/callback] ${why}`);
    return NextResponse.redirect(`${base}/dashboard?cal=failure`);
  };

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) return fail(`Google vrátil chybu: ${error}`);
    if (!code) return fail("Chýba authorization code.");

    // Authoritative identity = the session cookie; `state` must match it.
    const barberId = getBarberId();
    if (!barberId) return NextResponse.redirect(`${base}/onboarding`);
    if (state !== barberId) return fail("Nesúhlasí state (možný CSRF) — pripojenie zamietnuté.");

    const barber = await prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) return fail("Barber pre reláciu neexistuje.");

    const tokens = await exchangeCodeForTokens(code);
    await prisma.barber.update({
      where: { id: barberId },
      data: { googleCalendarTokens: tokens },
    });
    console.log(`[google/callback] kalendár pripojený pre barbera ${barberId}`);

    return NextResponse.redirect(`${base}/dashboard?cal=success`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
