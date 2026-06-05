// Single source of truth for time handling. EVERYTHING booking-related is in
// Europe/Bratislava local time. We store UTC instants in the DB and on the wire
// (Google freebusy uses UTC), but every *wall-clock* the customer/barber sees or
// types is Bratislava local — converted here with DST handled correctly
// (CET = UTC+1 winter, CEST = UTC+2 summer). This module fixes the earlier
// "everything was UTC" problem: convert with these helpers, never `new Date(str)`
// on a naive local string.

export const TIMEZONE = "Europe/Bratislava";

// Bratislava day-of-week (0 = Sunday … 6 = Saturday) → our working-hours keys.
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const SK_DAY_NAMES = [
  "nedeľa",
  "pondelok",
  "utorok",
  "streda",
  "štvrtok",
  "piatok",
  "sobota",
] as const;

/** Wall-clock parts of an instant, as seen in Bratislava. */
export type ZonedParts = {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
};

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Offset (ms) between Bratislava wall-clock and UTC at a given instant.
// offset = localWallTime(as-if-UTC) − instant. +2h in summer, +1h in winter.
function tzOffsetMs(instant: Date): number {
  const map: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // Intl renders hour "24" for midnight in some engines — normalise to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - instant.getTime();
}

/** Break an instant into its Bratislava wall-clock parts. */
export function toZonedParts(instant: Date): ZonedParts {
  const map: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const utcMidnight = Date.UTC(map.year, map.month - 1, map.day);
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    minute: map.minute,
    weekday: new Date(utcMidnight).getUTCDay(),
  };
}

/**
 * Convert a Bratislava wall-clock (e.g. "2026-06-04 15:00" local) to the correct
 * UTC instant. Two-pass to be correct across DST boundaries.
 */
export function zonedToUtc(
  year: number,
  month: number, // 1–12
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const off1 = tzOffsetMs(new Date(guess));
  let result = new Date(guess - off1);
  const off2 = tzOffsetMs(result);
  if (off2 !== off1) result = new Date(guess - off2);
  return result;
}

/** Weekday key ("mon"…"sun") for a calendar date in Bratislava. */
export function weekdayKey(weekday: number): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[weekday];
}

// ── Parsing helpers (validate AI/tool input) ─────────────────────────────────

/** Parse "YYYY-MM-DD" → {year, month, day} or null. */
export function parseDate(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Parse "HH:MM" → minutes since midnight, or null. */
export function parseTimeToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** "HH:MM" working-hours string → minutes since midnight (0 on bad input). */
export function hhmmToMinutes(s: string): number {
  return parseTimeToMinutes(s) ?? 0;
}

/** Combine a local date + minutes-since-midnight into a UTC instant. */
export function localDateMinutesToUtc(
  date: { year: number; month: number; day: number },
  minutes: number,
): Date {
  return zonedToUtc(date.year, date.month, date.day, Math.floor(minutes / 60), minutes % 60);
}

// ── Display (Slovak, always Bratislava) ──────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** "streda 4. 6. 2026 o 15:00" — for customer-facing + barber-facing text. */
export function formatBratislava(instant: Date): string {
  const p = toZonedParts(instant);
  return `${SK_DAY_NAMES[p.weekday]} ${p.day}. ${p.month}. ${p.year} o ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "15:00" Bratislava local time. */
export function formatTime(instant: Date): string {
  const p = toZonedParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Naive local datetime string for the Google event ("2026-06-04T15:00:00").
 *  Sent together with timeZone:"Europe/Bratislava" so Google stores it correctly. */
export function toGoogleLocalDateTime(instant: Date): string {
  const p = toZonedParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}
