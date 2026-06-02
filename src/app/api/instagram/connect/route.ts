import { NextResponse } from "next/server";
import { loadCurrentBarber } from "@/lib/barber";
import { createHostedAuthLink } from "@/lib/unipile";
import { getAppBaseUrl } from "@/lib/app-url";

export const runtime = "nodejs";

// Starts Unipile's hosted Instagram auth and returns the link to redirect to.
export async function POST(req: Request) {
  const barber = await loadCurrentBarber();
  if (!barber) return NextResponse.json({ error: "Relácia vypršala." }, { status: 401 });

  try {
    const base = getAppBaseUrl(req);
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    const { url } = await createHostedAuthLink({
      barberId: barber.id,
      successUrl: `${base}/dashboard?ig=success`,
      failureUrl: `${base}/dashboard?ig=failure`,
      notifyUrl: `${base}/api/instagram/notify`,
      expiresOn,
    });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[instagram/connect] error:", err);
    return NextResponse.json(
      { error: "Nepodarilo sa spustiť pripojenie Instagramu. Skúste to neskôr." },
      { status: 502 },
    );
  }
}
