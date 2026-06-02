import { z, ZodError } from "zod";
import { DAY_KEYS } from "./days";

// Single source of truth for validation, shared by the client wizard (instant
// feedback) and the API routes (authoritative). All messages are in Slovak.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ── Step 1: Prevádzka ────────────────────────────────────────────────────────
export const step1Schema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, "Zadajte názov prevádzky.")
    .max(120, "Názov je príliš dlhý."),
  phone: z
    .string()
    .trim()
    .min(1, "Zadajte telefónne číslo.")
    .regex(/^[+0-9][0-9\s()/-]{4,19}$/, "Zadajte platné telefónne číslo."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Zadajte e-mail.")
    .email("Zadajte platný e-mail."),
  address: z
    .string()
    .trim()
    .min(1, "Zadajte adresu.")
    .max(200, "Adresa je príliš dlhá."),
});

// ── Step 2: Pracovný čas ─────────────────────────────────────────────────────
const dayShape = z.object({
  open: z.boolean(),
  from: z.string(),
  to: z.string(),
});

const workingHoursSchema = z
  .object({
    mon: dayShape,
    tue: dayShape,
    wed: dayShape,
    thu: dayShape,
    fri: dayShape,
    sat: dayShape,
    sun: dayShape,
  })
  .superRefine((hours, ctx) => {
    for (const key of DAY_KEYS) {
      const day = hours[key];
      if (!day.open) continue;
      const fromOk = TIME_RE.test(day.from);
      const toOk = TIME_RE.test(day.to);
      if (!fromOk) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key, "from"], message: "Neplatný čas." });
      }
      if (!toOk) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key, "to"], message: "Neplatný čas." });
      }
      // Only compare once both are well-formed; "HH:MM" compares correctly as strings.
      if (fromOk && toOk && day.from >= day.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, "to"],
          message: "Čas „do“ musí byť neskôr ako „od“.",
        });
      }
    }
    if (!DAY_KEYS.some((k) => hours[k].open)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "Vyberte aspoň jeden pracovný deň." });
    }
  });

export const step2Schema = z.object({
  bufferMin: z.coerce
    .number({ invalid_type_error: "Zadajte číslo." })
    .int("Zadajte celé číslo.")
    .min(0, "Prestávka nemôže byť záporná.")
    .max(240, "Prestávka môže byť najviac 240 minút."),
  workingHours: workingHoursSchema,
});

// ── Step 3: Služby ───────────────────────────────────────────────────────────
export const serviceSchema = z.object({
  // Present when editing an existing service row; absent for new rows.
  id: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Zadajte názov služby.")
    .max(120, "Názov je príliš dlhý."),
  durationMin: z.coerce
    .number({ invalid_type_error: "Zadajte trvanie." })
    .int("Zadajte celé číslo minút.")
    .positive("Trvanie musí byť kladné.")
    .max(1440, "Trvanie je príliš dlhé."),
  priceEur: z.coerce
    .number({ invalid_type_error: "Zadajte cenu." })
    .nonnegative("Cena nemôže byť záporná.")
    .max(100000, "Cena je príliš vysoká."),
});

export const step3Schema = z.object({
  services: z.array(serviceSchema).min(1, "Pridajte aspoň jednu službu."),
});

// ── Step 5: Štýl AI ──────────────────────────────────────────────────────────
export const step5Schema = z.object({
  aiStyle: z
    .string()
    .trim()
    .max(20000, "Text je príliš dlhý (max 20 000 znakov).")
    .optional()
    .default(""),
});

export type Step1Input = z.infer<typeof step1Schema>;
export type Step2Input = z.infer<typeof step2Schema>;
export type Step3Input = z.infer<typeof step3Schema>;
export type Step5Input = z.infer<typeof step5Schema>;
export type ServiceInput = z.infer<typeof serviceSchema>;

/**
 * Flatten a ZodError into a `{ "path.to.field": "message" }` map. The first
 * issue per field wins. Array/nested paths join with dots (e.g. "services.0.name").
 * Form-level issues (empty path) land under "_form".
 */
export function zodErrorMap(error: ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!(key in map)) map[key] = issue.message;
  }
  return map;
}
