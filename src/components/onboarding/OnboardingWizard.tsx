"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import {
  step1Schema,
  step2Schema,
  step3Schema,
  step5Schema,
  zodErrorMap,
} from "@/lib/validation";
import { Button } from "@/components/ui/Button";
import { ProgressSteps } from "./ProgressSteps";
import { Step1Prevadzka } from "./steps/Step1Prevadzka";
import { Step2PracovnyCas } from "./steps/Step2PracovnyCas";
import { Step3Sluzby } from "./steps/Step3Sluzby";
import { Step4Instagram } from "./steps/Step4Instagram";
import { Step5Styl } from "./steps/Step5Styl";
import {
  STEP_SUBTITLES,
  STEP_TITLES,
  TOTAL_STEPS,
  type WizardData,
  type WizardMode,
} from "./types";

type Props = {
  initialData: WizardData;
  initialStep: number;
  mode: WizardMode;
};

// For each step: which schema validates it (step 4 has nothing to validate) and
// which slice of wizard state it submits.
function buildPayload(
  step: number,
  data: WizardData,
): { schema: z.ZodTypeAny | null; payload: unknown } {
  switch (step) {
    case 1:
      return {
        schema: step1Schema,
        payload: {
          businessName: data.businessName,
          phone: data.phone,
          email: data.email,
          address: data.address,
        },
      };
    case 2:
      return {
        schema: step2Schema,
        payload: { bufferMin: data.bufferMin, workingHours: data.workingHours },
      };
    case 3:
      return {
        schema: step3Schema,
        payload: {
          services: data.services.map((s) => ({
            id: s.id,
            name: s.name,
            durationMin: s.durationMin,
            priceEur: s.priceEur,
          })),
        },
      };
    case 5:
      return { schema: step5Schema, payload: { aiStyle: data.aiStyle } };
    default:
      return { schema: null, payload: {} };
  }
}

export function OnboardingWizard({ initialData, initialStep, mode }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [data, setData] = useState<WizardData>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = mode === "edit";

  function update(patch: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...patch }));
  }

  function scrollTop() {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Validate locally (instant feedback), then persist to the server (authoritative).
  async function saveStep(): Promise<boolean> {
    setFormError(null);
    const { schema, payload } = buildPayload(step, data);

    let body: unknown = payload;
    if (schema) {
      const result = schema.safeParse(payload);
      if (!result.success) {
        setErrors(zodErrorMap(result.error));
        return false;
      }
      body = result.data; // coerced & cleaned
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/onboarding/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        errors?: Record<string, string>;
        error?: string;
      };
      if (!res.ok) {
        if (json.errors) setErrors(json.errors);
        else setFormError(json.error ?? "Nastala chyba. Skúste to znova.");
        return false;
      }
      setErrors({});
      return true;
    } catch {
      setFormError("Nepodarilo sa spojiť so serverom. Skúste to, prosím, znova.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  function goToDashboard() {
    router.push("/dashboard");
    router.refresh();
  }

  async function handlePrimary() {
    const ok = await saveStep();
    if (!ok) return;
    if (isEdit || step === TOTAL_STEPS) {
      goToDashboard();
      return;
    }
    setStep((s) => s + 1);
    setErrors({});
    scrollTop();
  }

  function handleSecondary() {
    if (isEdit) {
      goToDashboard();
      return;
    }
    if (step > 1) {
      setStep((s) => s - 1);
      setErrors({});
      setFormError(null);
      scrollTop();
    }
  }

  const primaryLabel = isEdit ? "Uložiť" : step < TOTAL_STEPS ? "Pokračovať" : "Dokončiť";
  const showSecondary = isEdit || step > 1;
  const secondaryLabel = isEdit ? "Zrušiť" : "Späť";

  return (
    <div>
      {isEdit ? (
        <p className="mb-6 text-sm text-slate-500">
          Upraviť · <span className="font-medium text-slate-700">{STEP_TITLES[step]}</span>
        </p>
      ) : (
        <div className="mb-8">
          <ProgressSteps current={step} />
          <p className="mt-3 text-xs text-slate-400">
            Krok {step} z {TOTAL_STEPS}
          </p>
        </div>
      )}

      <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{STEP_TITLES[step]}</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">{STEP_SUBTITLES[step]}</p>

      {formError && (
        <div className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-100">
          {formError}
        </div>
      )}

      {step === 1 && <Step1Prevadzka data={data} update={update} errors={errors} />}
      {step === 2 && <Step2PracovnyCas data={data} update={update} errors={errors} />}
      {step === 3 && <Step3Sluzby data={data} update={update} errors={errors} />}
      {step === 4 && <Step4Instagram />}
      {step === 5 && <Step5Styl data={data} update={update} errors={errors} />}

      <div className="mt-8 flex items-center justify-between gap-3">
        <div>
          {showSecondary && (
            <Button variant="ghost" onClick={handleSecondary} disabled={submitting}>
              {secondaryLabel}
            </Button>
          )}
        </div>
        <Button onClick={handlePrimary} disabled={submitting}>
          {submitting ? "Ukladám…" : primaryLabel}
        </Button>
      </div>
    </div>
  );
}
