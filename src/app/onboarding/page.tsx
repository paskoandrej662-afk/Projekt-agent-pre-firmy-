import { redirect } from "next/navigation";
import { loadCurrentBarber } from "@/lib/barber";
import { normalizeWorkingHours } from "@/lib/days";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import type { WizardData, WizardMode } from "@/components/onboarding/types";

function parseStep(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  const barber = await loadCurrentBarber();
  const requested = parseStep(searchParams.step);
  const complete = barber?.onboardingComplete ?? false;

  // A finished barber only re-enters the wizard to edit a specific section.
  if (complete && !requested) redirect("/dashboard");

  const mode: WizardMode = complete ? "edit" : "onboard";
  const startStep = requested ?? barber?.onboardingStep ?? 1;

  const initialData: WizardData = {
    businessName: barber?.businessName ?? "",
    phone: barber?.phone ?? "",
    email: barber?.email ?? "",
    address: barber?.address ?? "",
    workingHours: normalizeWorkingHours(barber?.workingHours),
    bufferMin: String(barber?.bufferMin ?? 0),
    services:
      barber && barber.services.length > 0
        ? barber.services.map((s) => ({
            id: s.id,
            name: s.name,
            durationMin: String(s.durationMin),
            priceEur: s.priceEur.toString(),
          }))
        : [{ name: "", durationMin: "", priceEur: "" }],
    aiStyle: barber?.aiStyle ?? "",
  };

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col px-4 py-8 sm:py-12">
      <header className="mb-8">
        <span className="text-lg font-bold tracking-tight">
          Barber<span className="text-brand-600">AI</span>
        </span>
      </header>
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <OnboardingWizard initialData={initialData} initialStep={startStep} mode={mode} />
      </div>
    </main>
  );
}
