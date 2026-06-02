import { NextResponse } from "next/server";
import { clearBarberId } from "@/lib/session";

export const runtime = "nodejs";

// Clears the session cookie. Handy during development to test multiple tenants
// from one browser. (No real auth exists yet — see src/lib/session.ts.)
export async function POST(req: Request) {
  clearBarberId();
  // 303 forces the follow-up request to use GET.
  return NextResponse.redirect(new URL("/onboarding", req.url), 303);
}
