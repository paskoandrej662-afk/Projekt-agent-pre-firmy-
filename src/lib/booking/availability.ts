// Pure slot math — no I/O. Given busy ranges (from Google freebusy, titles already
// stripped), the barber's working hours, and a service duration + buffer, decide
// whether a specific slot is bookable and enumerate / find free slots.
//
// A slot is bookable iff (per the spec):
//   • the SERVICE [start, start+duration) sits within that day's working hours,
//   • the block [start, start+duration+buffer) overlaps NO busy range, and
//   • the start is not in the past.
// Buffer is the gap *after* the appointment; it may run past closing time but must
// stay clear of other bookings.

import type { BusyRange } from "@/lib/google/calendar";
import { normalizeWorkingHours, type WorkingHours } from "@/lib/days";
import {
  hhmmToMinutes,
  localDateMinutesToUtc,
  toZonedParts,
  weekdayKey,
  type ZonedParts,
} from "./timezone";

const MS_PER_MIN = 60_000;
// Granularity for *offering* slots to the customer (clean :00/:30 starts).
const SLOT_STEP_MIN = 30;
// How far ahead "nearest free slot" search looks.
const SEARCH_HORIZON_DAYS = 21;

export type LocalDate = { year: number; month: number; day: number };

export type DayWindow = { open: boolean; fromMin: number; toMin: number };

/** Working hours for a given calendar date, in minutes-since-midnight (local). */
export function windowForDate(workingHours: unknown, date: LocalDate): DayWindow {
  const hours: WorkingHours = normalizeWorkingHours(workingHours);
  // getUTCDay on the date's UTC midnight yields the correct weekday for a calendar date.
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const day = hours[weekdayKey(weekday)];
  return { open: day.open, fromMin: hhmmToMinutes(day.from), toMin: hhmmToMinutes(day.to) };
}

function overlapsBusy(start: Date, end: Date, busy: BusyRange[]): boolean {
  const s = start.getTime();
  const e = end.getTime();
  // Overlap iff start < busy.end AND end > busy.start (touching edges is allowed).
  return busy.some((b) => s < b.end.getTime() && e > b.start.getTime());
}

export type SlotCheck =
  | { ok: true }
  | { ok: false; reason: "closed" | "outside_hours" | "in_past" | "busy" };

/**
 * Is this exact local slot bookable? `excludeBusy` lets reschedule ignore the
 * customer's own current event (so moving within its window isn't a self-conflict).
 */
export function checkSlot(opts: {
  date: LocalDate;
  startMin: number;
  durationMin: number;
  bufferMin: number;
  window: DayWindow;
  busy: BusyRange[];
  now: Date;
}): SlotCheck {
  const { date, startMin, durationMin, bufferMin, window, busy, now } = opts;
  if (!window.open) return { ok: false, reason: "closed" };

  const serviceEndMin = startMin + durationMin;
  if (startMin < window.fromMin || serviceEndMin > window.toMin) {
    return { ok: false, reason: "outside_hours" };
  }

  const start = localDateMinutesToUtc(date, startMin);
  if (start.getTime() < now.getTime()) return { ok: false, reason: "in_past" };

  const blockEnd = new Date(start.getTime() + (durationMin + bufferMin) * MS_PER_MIN);
  if (overlapsBusy(start, blockEnd, busy)) return { ok: false, reason: "busy" };

  return { ok: true };
}

/** UTC start/end instants for the SERVICE itself (no buffer) at a local slot. */
export function slotInstants(
  date: LocalDate,
  startMin: number,
  durationMin: number,
): { start: Date; end: Date } {
  const start = localDateMinutesToUtc(date, startMin);
  return { start, end: new Date(start.getTime() + durationMin * MS_PER_MIN) };
}

/**
 * Enumerate offerable free start-times ("HH:MM") for one day, stepping on a clean
 * grid. Returns up to `limit` slots.
 */
export function freeSlotsForDay(opts: {
  date: LocalDate;
  durationMin: number;
  bufferMin: number;
  workingHours: unknown;
  busy: BusyRange[];
  now: Date;
  limit?: number;
}): string[] {
  const { date, durationMin, bufferMin, workingHours, busy, now } = opts;
  const limit = opts.limit ?? 12;
  const window = windowForDate(workingHours, date);
  if (!window.open) return [];

  const out: string[] = [];
  // First grid point ≥ fromMin (aligned to the step).
  let startMin = Math.ceil(window.fromMin / SLOT_STEP_MIN) * SLOT_STEP_MIN;
  if (startMin < window.fromMin) startMin += SLOT_STEP_MIN;

  for (; startMin + durationMin <= window.toMin && out.length < limit; startMin += SLOT_STEP_MIN) {
    const check = checkSlot({ date, startMin, durationMin, bufferMin, window, busy, now });
    if (check.ok) {
      out.push(`${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`);
    }
  }
  return out;
}

/**
 * Find the nearest free slot at/after `fromInstant` that fits, scanning forward
 * day by day up to the horizon. Needs the caller to supply busy ranges for the
 * whole horizon. Returns the local date + "HH:MM", or null if none found.
 */
export function findNearestSlot(opts: {
  fromInstant: Date;
  durationMin: number;
  bufferMin: number;
  workingHours: unknown;
  busy: BusyRange[];
  now: Date;
}): { date: LocalDate; time: string } | null {
  const { fromInstant, durationMin, bufferMin, workingHours, busy, now } = opts;
  const fromParts: ZonedParts = toZonedParts(fromInstant);
  const lowerBoundMin = fromParts.hour * 60 + fromParts.minute;

  for (let dayOffset = 0; dayOffset < SEARCH_HORIZON_DAYS; dayOffset++) {
    // Advance the calendar date by `dayOffset` days (in local terms).
    const probe = toZonedParts(new Date(fromInstant.getTime() + dayOffset * 24 * 60 * MS_PER_MIN));
    const date: LocalDate = { year: probe.year, month: probe.month, day: probe.day };
    const window = windowForDate(workingHours, date);
    if (!window.open) continue;

    let startMin = Math.ceil(window.fromMin / SLOT_STEP_MIN) * SLOT_STEP_MIN;
    // On the first day, don't offer anything before the requested time.
    if (dayOffset === 0 && startMin < lowerBoundMin) {
      startMin = Math.ceil(lowerBoundMin / SLOT_STEP_MIN) * SLOT_STEP_MIN;
    }

    for (; startMin + durationMin <= window.toMin; startMin += SLOT_STEP_MIN) {
      const check = checkSlot({ date, startMin, durationMin, bufferMin, window, busy, now });
      if (check.ok) return { date, time: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}` };
    }
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
