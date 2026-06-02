import type { WorkingHours } from "@/lib/days";

// One service row in the wizard. Numeric fields are kept as strings while
// editing (controlled inputs); validation coerces them.
export type ServiceRow = {
  id?: string;
  name: string;
  durationMin: string;
  priceEur: string;
};

// The full editable state of the onboarding wizard.
export type WizardData = {
  businessName: string;
  phone: string;
  email: string;
  address: string;
  workingHours: WorkingHours;
  bufferMin: string;
  services: ServiceRow[];
  aiStyle: string;
};

export type WizardMode = "onboard" | "edit";

export type StepProps = {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  errors: Record<string, string>;
};

export const TOTAL_STEPS = 5;

// Full headings (shown at the top of each step).
export const STEP_TITLES: Record<number, string> = {
  1: "Prevádzka",
  2: "Pracovný čas",
  3: "Služby",
  4: "Pripojenie Instagramu",
  5: "Naučte AI svoj štýl",
};

// Short labels for the progress indicator.
export const STEP_SHORT: Record<number, string> = {
  1: "Prevádzka",
  2: "Čas",
  3: "Služby",
  4: "Instagram",
  5: "Štýl AI",
};

// One-line helper shown under each step heading.
export const STEP_SUBTITLES: Record<number, string> = {
  1: "Základné údaje o vašom podniku.",
  2: "Kedy ste otvorení a koľko času potrebujete medzi zákazníkmi.",
  3: "Čo ponúkate, ako dlho to trvá a koľko to stojí.",
  4: "Prepojenie sociálnych sietí (čoskoro).",
  5: "Pomôžte AI písať vaším štýlom.",
};
