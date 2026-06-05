// Booking orchestration: live freebusy re-check + Google event writes + Booking
// rows. Each function returns a plain JSON-serialisable result that becomes a
// tool_result for the AI — never throws for "expected" outcomes (slot taken, not
// connected, …); only genuinely unexpected bugs would bubble up, and the agent
// loop guards those too.
//
// Customer ↔ appointment link is ALWAYS Booking.conversationId (the reliable key).
// MVP rule: one conversation = at most one active CONFIRMED booking.

import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GoogleNotConnectedError,
  createEvent,
  deleteEvent,
  getBusyRanges,
  getValidAccessToken,
  type BusyRange,
} from "@/lib/google/calendar";
import {
  checkSlot,
  findNearestSlot,
  freeSlotsForDay,
  slotInstants,
  windowForDate,
  type LocalDate,
} from "./availability";
import {
  formatBratislava,
  parseDate,
  parseTimeToMinutes,
  toGoogleLocalDateTime,
} from "./timezone";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_HORIZON_DAYS = 21;

export type BookingContext = {
  barber: { id: string; bufferMin: number; workingHours: unknown; googleCalendarTokens: unknown };
  services: { id: string; name: string; durationMin: number }[];
  conversation: { id: string; customerHandle: string; customerName: string | null };
  now: Date;
};

// ── Service + helpers ────────────────────────────────────────────────────────

function resolveService(services: BookingContext["services"], name: string) {
  const q = name.trim().toLowerCase();
  const exact = services.find((s) => s.name.trim().toLowerCase() === q);
  if (exact) return exact;
  const contains = services.filter((s) => s.name.toLowerCase().includes(q));
  return contains.length === 1 ? contains[0] : null;
}

const validServiceNames = (services: BookingContext["services"]) => services.map((s) => s.name);

function displayName(ctx: BookingContext): string {
  return ctx.conversation.customerName?.trim() || `@${ctx.conversation.customerHandle}`;
}

function eventSummary(ctx: BookingContext, serviceName: string): string {
  return `${serviceName} — ${displayName(ctx)} (@${ctx.conversation.customerHandle})`;
}

/** Active CONFIRMED booking for this conversation (the one we can move/cancel). */
export async function getActiveBooking(conversationId: string) {
  return prisma.booking.findFirst({
    where: { conversationId, status: "CONFIRMED" as BookingStatus },
    orderBy: { startTime: "desc" },
    include: { service: true },
  });
}

// Fetch busy ranges live for an explicit [from, to] window. Callers size it:
// a single day for check_availability, or now→horizon (plus the target) for
// book/reschedule so the same data also powers the "nearest free" search.
// Google's freeBusy range is capped well above our needs; we clamp defensively.
const MAX_FREEBUSY_DAYS = 80;
async function fetchBusyWindow(ctx: BookingContext, from: Date, to: Date): Promise<BusyRange[]> {
  const token = await getValidAccessToken(ctx.barber);
  const cappedTo = new Date(Math.min(to.getTime(), from.getTime() + MAX_FREEBUSY_DAYS * DAY_MS));
  return getBusyRanges(token, from, cappedTo);
}

// Window covering now → horizon, extended to include a specific target instant.
function horizonWindow(ctx: BookingContext, ...targets: Date[]): { from: Date; to: Date } {
  const times = [ctx.now, ...targets].map((d) => d.getTime());
  const from = new Date(Math.min(...times) - DAY_MS);
  const to = new Date(Math.max(ctx.now.getTime() + (SEARCH_HORIZON_DAYS + 1) * DAY_MS, ...times) + DAY_MS);
  return { from, to };
}

function nearestPayload(
  ctx: BookingContext,
  fromInstant: Date,
  durationMin: number,
  busy: BusyRange[],
) {
  const near = findNearestSlot({
    fromInstant,
    durationMin,
    bufferMin: ctx.barber.bufferMin,
    workingHours: ctx.barber.workingHours,
    busy,
    now: ctx.now,
  });
  if (!near) return null;
  const { start } = slotInstants(near.date, hhmm(near.time), durationMin);
  return { date: dateStr(near.date), time: near.time, humanWhen: formatBratislava(start) };
}

// ── (B) check_availability ───────────────────────────────────────────────────

export type CheckResult =
  | { ok: true; date: string; serviceName: string; durationMin: number; slots: string[] }
  | { ok: false; reason: "not_connected" | "bad_date" | "unknown_service" | "closed" | "calendar_error"; validServices?: string[] };

export async function checkAvailabilityAction(
  ctx: BookingContext,
  input: { date: string; service_name?: string },
): Promise<CheckResult> {
  const parsed = parseDate(input.date ?? "");
  if (!parsed) return { ok: false, reason: "bad_date" };
  const date: LocalDate = parsed;

  // Service is optional; if omitted we size slots by the SHORTEST service so we
  // show times where at least something fits.
  let service = ctx.services[0] ?? null;
  if (input.service_name) {
    const s = resolveService(ctx.services, input.service_name);
    if (!s) return { ok: false, reason: "unknown_service", validServices: validServiceNames(ctx.services) };
    service = s;
  } else {
    service = [...ctx.services].sort((a, b) => a.durationMin - b.durationMin)[0] ?? null;
  }
  if (!service) return { ok: false, reason: "unknown_service", validServices: [] };

  const window = windowForDate(ctx.barber.workingHours, date);
  if (!window.open) return { ok: false, reason: "closed" };

  try {
    // Just this day (± a day for buffer spillover) — no nearest-search needed here.
    const dayStart = slotInstants(date, 0, 0).start;
    const busy = await fetchBusyWindow(ctx, new Date(dayStart.getTime() - DAY_MS), new Date(dayStart.getTime() + 2 * DAY_MS));
    const slots = freeSlotsForDay({
      date,
      durationMin: service.durationMin,
      bufferMin: ctx.barber.bufferMin,
      workingHours: ctx.barber.workingHours,
      busy,
      now: ctx.now,
    });
    return { ok: true, date: input.date, serviceName: service.name, durationMin: service.durationMin, slots };
  } catch (err) {
    return handleCalendarError("check_availability", err) as CheckResult;
  }
}

// ── (C) book_appointment ─────────────────────────────────────────────────────

export type BookResult =
  | { ok: true; serviceName: string; date: string; time: string; humanWhen: string }
  | {
      ok: false;
      reason:
        | "not_connected" | "bad_datetime" | "unknown_service" | "closed" | "outside_hours"
        | "in_past" | "slot_taken" | "already_booked" | "calendar_error";
      validServices?: string[];
      window?: string;
      nearest?: { date: string; time: string; humanWhen: string } | null;
      existing?: { humanWhen: string; serviceName: string };
    };

export async function bookAppointmentAction(
  ctx: BookingContext,
  input: { service_name: string; date: string; time: string },
): Promise<BookResult> {
  const service = resolveService(ctx.services, input.service_name ?? "");
  if (!service) return { ok: false, reason: "unknown_service", validServices: validServiceNames(ctx.services) };

  const parsedDate = parseDate(input.date ?? "");
  const startMin = parseTimeToMinutes(input.time ?? "");
  if (!parsedDate || startMin == null) return { ok: false, reason: "bad_datetime" };
  const date: LocalDate = parsedDate;

  // One active booking per conversation.
  const existing = await getActiveBooking(ctx.conversation.id);
  if (existing) {
    return {
      ok: false,
      reason: "already_booked",
      existing: { humanWhen: formatBratislava(existing.startTime), serviceName: existing.service.name },
    };
  }

  const window = windowForDate(ctx.barber.workingHours, date);
  const { start, end } = slotInstants(date, startMin, service.durationMin);

  try {
    // Live re-check (never trust cache) over a window wide enough for nearest search.
    const { from, to } = horizonWindow(ctx, start);
    const busy = await fetchBusyWindow(ctx, from, to);
    const check = checkSlot({
      date, startMin, durationMin: service.durationMin, bufferMin: ctx.barber.bufferMin,
      window, busy, now: ctx.now,
    });
    if (!check.ok) {
      if (check.reason === "closed") return { ok: false, reason: "closed" };
      if (check.reason === "outside_hours") {
        return { ok: false, reason: "outside_hours", window: windowLabel(window) };
      }
      if (check.reason === "in_past") return { ok: false, reason: "in_past" };
      // busy → offer the nearest fitting slot.
      return { ok: false, reason: "slot_taken", nearest: nearestPayload(ctx, start, service.durationMin, busy) };
    }

    const token = await getValidAccessToken(ctx.barber);
    const eventId = await createEvent(token, {
      summary: eventSummary(ctx, service.name),
      localStart: toGoogleLocalDateTime(start),
      localEnd: toGoogleLocalDateTime(end),
    });

    try {
      await prisma.booking.create({
        data: {
          barberId: ctx.barber.id,
          conversationId: ctx.conversation.id,
          customerName: displayName(ctx),
          serviceId: service.id,
          startTime: start,
          endTime: end,
          googleEventId: eventId,
          status: "CONFIRMED",
        },
      });
    } catch (dbErr) {
      // Roll the calendar back so we never orphan an event without a Booking row.
      await deleteEvent(token, eventId).catch(() => {});
      throw dbErr;
    }

    console.log(`[booking] vytvorená rezervácia ${service.name} @ ${formatBratislava(start)} (event ${eventId})`);
    return { ok: true, serviceName: service.name, date: input.date, time: input.time, humanWhen: formatBratislava(start) };
  } catch (err) {
    return handleCalendarError("book", err) as BookResult;
  }
}

// ── (D) reschedule_appointment ───────────────────────────────────────────────

export type RescheduleResult =
  | { ok: true; serviceName: string; date: string; time: string; humanWhen: string; previous: { humanWhen: string } }
  | {
      ok: false;
      reason: "not_connected" | "no_booking" | "bad_datetime" | "closed" | "outside_hours" | "in_past" | "slot_taken" | "calendar_error";
      window?: string;
      nearest?: { date: string; time: string; humanWhen: string } | null;
    };

export async function rescheduleAppointmentAction(
  ctx: BookingContext,
  input: { date: string; time: string },
): Promise<RescheduleResult> {
  const booking = await getActiveBooking(ctx.conversation.id);
  if (!booking) return { ok: false, reason: "no_booking" };

  const parsedDate = parseDate(input.date ?? "");
  const startMin = parseTimeToMinutes(input.time ?? "");
  if (!parsedDate || startMin == null) return { ok: false, reason: "bad_datetime" };
  const date: LocalDate = parsedDate;

  const durationMin = booking.service.durationMin;
  const window = windowForDate(ctx.barber.workingHours, date);
  const { start: newStart, end: newEnd } = slotInstants(date, startMin, durationMin);

  try {
    const { from, to } = horizonWindow(ctx, booking.startTime, newStart);
    const busyRaw = await fetchBusyWindow(ctx, from, to);
    // Exclude the customer's OWN current event so moving within/near it isn't a
    // self-conflict. We drop busy ranges fully contained in the old [start,end].
    const oldS = booking.startTime.getTime();
    const oldE = booking.endTime.getTime();
    const busy = busyRaw.filter((b) => !(b.start.getTime() >= oldS - 60_000 && b.end.getTime() <= oldE + 60_000));

    const check = checkSlot({
      date, startMin, durationMin, bufferMin: ctx.barber.bufferMin, window, busy, now: ctx.now,
    });
    if (!check.ok) {
      if (check.reason === "closed") return { ok: false, reason: "closed" };
      if (check.reason === "outside_hours") return { ok: false, reason: "outside_hours", window: windowLabel(window) };
      if (check.reason === "in_past") return { ok: false, reason: "in_past" };
      return { ok: false, reason: "slot_taken", nearest: nearestPayload(ctx, newStart, durationMin, busy) };
    }

    // ORDER (the overriding rule is "never leave the customer with no appointment"):
    // verify new slot (done) → create new event → switch the DB row to it → only
    // THEN remove the old event (best-effort). If create fails, the old booking is
    // untouched. Worst case is a transient duplicate event, never a gap.
    const token = await getValidAccessToken(ctx.barber);
    const newEventId = await createEvent(token, {
      summary: eventSummary(ctx, booking.service.name),
      localStart: toGoogleLocalDateTime(newStart),
      localEnd: toGoogleLocalDateTime(newEnd),
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { startTime: newStart, endTime: newEnd, googleEventId: newEventId },
    });

    if (booking.googleEventId) {
      await deleteEvent(token, booking.googleEventId).catch((e) =>
        console.warn(`[booking] staré udalosť ${booking.googleEventId} sa nepodarilo zmazať: ${e?.message ?? e}`),
      );
    }

    console.log(`[booking] presunutá rezervácia ${booking.id} → ${formatBratislava(newStart)} (event ${newEventId})`);
    return {
      ok: true,
      serviceName: booking.service.name,
      date: input.date,
      time: input.time,
      humanWhen: formatBratislava(newStart),
      previous: { humanWhen: formatBratislava(booking.startTime) },
    };
  } catch (err) {
    return handleCalendarError("reschedule", err) as RescheduleResult;
  }
}

// ── (E) cancel_appointment ───────────────────────────────────────────────────

export type CancelResult =
  | { ok: true; serviceName: string; humanWhen: string }
  | { ok: false; reason: "not_connected" | "no_booking" | "calendar_error" };

export async function cancelAppointmentAction(ctx: BookingContext): Promise<CancelResult> {
  const booking = await getActiveBooking(ctx.conversation.id);
  if (!booking) return { ok: false, reason: "no_booking" };

  try {
    if (booking.googleEventId) {
      const token = await getValidAccessToken(ctx.barber);
      await deleteEvent(token, booking.googleEventId);
    }
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
    console.log(`[booking] zrušená rezervácia ${booking.id} (${formatBratislava(booking.startTime)})`);
    return { ok: true, serviceName: booking.service.name, humanWhen: formatBratislava(booking.startTime) };
  } catch (err) {
    return handleCalendarError("cancel", err) as CancelResult;
  }
}

// ── shared error mapping ──────────────────────────────────────────────────────

function handleCalendarError(where: string, err: unknown): { ok: false; reason: "not_connected" | "calendar_error" } {
  if (err instanceof GoogleNotConnectedError) return { ok: false, reason: "not_connected" };
  console.error(`[booking] ${where} — chyba kalendára:`, err instanceof Error ? err.message : err);
  return { ok: false, reason: "calendar_error" };
}

// ── tiny local utils ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: LocalDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const hhmm = (t: string) => parseTimeToMinutes(t) ?? 0;
const windowLabel = (w: { fromMin: number; toMin: number }) =>
  `${pad(Math.floor(w.fromMin / 60))}:${pad(w.fromMin % 60)}–${pad(Math.floor(w.toMin / 60))}:${pad(w.toMin % 60)}`;
