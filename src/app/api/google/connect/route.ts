import { NextResponse } from "next/server";
import { getBarberId } from "@/lib/session";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/google/oauth";
import { getAppBaseUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// (A) Start Google Calendar OAuth. The barber just clicks the dashboard button,
// which navigates here; we bounce them to Google's consent screen. The barber id
// (from the session cookie) rides along as `state` and is verified in the callback.
export async function GET(req: Request) {
  const base = getAppBaseUrl(req);
  const barberId = getBarberId();
  if (!barberId) return NextResponse.redirect(`${base}/onboarding`);

  if (!isGoogleConfigured()) {
    console.error("[google/connect] Google OAuth nie je nakonfigurovaný (chýbajú GOOGLE_* premenné).");
    return NextResponse.redirect(`${base}/dashboard?cal=config`);
  }

  return NextResponse.redirect(buildAuthUrl(barberId));
}
