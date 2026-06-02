import { redirect } from "next/navigation";
import { loadCurrentBarber } from "@/lib/barber";

// Entry point: send completed barbers to their dashboard, everyone else into
// the onboarding wizard (which resumes at the right step).
export default async function Home() {
  const barber = await loadCurrentBarber();
  if (barber?.onboardingComplete) redirect("/dashboard");
  redirect("/onboarding");
}
