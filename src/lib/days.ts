// Shared working-hours model + Slovak day labels. Used by the wizard, the
// dashboard and validation so there is a single source of truth.

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type DayHours = {
  open: boolean;
  from: string; // "HH:MM"
  to: string; // "HH:MM"
};

export type WorkingHours = Record<DayKey, DayHours>;

/** Full Slovak names, in week order. */
export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Pondelok",
  tue: "Utorok",
  wed: "Streda",
  thu: "Štvrtok",
  fri: "Piatok",
  sat: "Sobota",
  sun: "Nedeľa",
};

/** Sensible starting hours: open Mon–Fri 09:00–17:00, closed on weekends. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: { open: true, from: "09:00", to: "17:00" },
  tue: { open: true, from: "09:00", to: "17:00" },
  wed: { open: true, from: "09:00", to: "17:00" },
  thu: { open: true, from: "09:00", to: "17:00" },
  fri: { open: true, from: "09:00", to: "17:00" },
  sat: { open: false, from: "09:00", to: "13:00" },
  sun: { open: false, from: "09:00", to: "13:00" },
};

/**
 * Merge stored hours (which may be partial or empty, e.g. before step 2 is done)
 * with the defaults so every day is always present and well-formed.
 */
export function normalizeWorkingHours(raw: unknown): WorkingHours {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<DayKey, Partial<DayHours>>
  >;
  const result = {} as WorkingHours;
  for (const key of DAY_KEYS) {
    const fallback = DEFAULT_WORKING_HOURS[key];
    const day = source[key] ?? {};
    result[key] = {
      open: typeof day.open === "boolean" ? day.open : fallback.open,
      from: typeof day.from === "string" ? day.from : fallback.from,
      to: typeof day.to === "string" ? day.to : fallback.to,
    };
  }
  return result;
}
