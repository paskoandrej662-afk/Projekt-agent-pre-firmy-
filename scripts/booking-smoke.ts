// Pure-logic smoke test for Step 3 timezone + availability math.
// No Google / DB / Claude calls. Run: npx tsx scripts/booking-smoke.ts
import {
  zonedToUtc,
  formatBratislava,
  toZonedParts,
  toGoogleLocalDateTime,
} from "@/lib/booking/timezone";
import {
  checkSlot,
  freeSlotsForDay,
  findNearestSlot,
  windowForDate,
} from "@/lib/booking/availability";
import type { BusyRange } from "@/lib/google/calendar";

let failures = 0;
function assert(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

// Mon–Sat 09:00–17:00 open, Sun closed.
const workingHours = {
  mon: { open: true, from: "09:00", to: "17:00" },
  tue: { open: true, from: "09:00", to: "17:00" },
  wed: { open: true, from: "09:00", to: "17:00" },
  thu: { open: true, from: "09:00", to: "17:00" },
  fri: { open: true, from: "09:00", to: "17:00" },
  sat: { open: true, from: "09:00", to: "13:00" },
  sun: { open: false, from: "09:00", to: "13:00" },
};

// 1) DST-correct wall-clock → UTC.
const summer = zonedToUtc(2026, 6, 4, 15, 0); // CEST = UTC+2 → 13:00Z
assert("Leto: 2026-06-04 15:00 Bratislava = 13:00 UTC", summer.toISOString() === "2026-06-04T13:00:00.000Z", summer.toISOString());

const winter = zonedToUtc(2026, 1, 15, 15, 0); // CET = UTC+1 → 14:00Z
assert("Zima: 2026-01-15 15:00 Bratislava = 14:00 UTC", winter.toISOString() === "2026-01-15T14:00:00.000Z", winter.toISOString());

// 2) Round-trip back to local parts + Google local string.
const p = toZonedParts(summer);
assert("Round-trip späť na 15:00 (streda)", p.hour === 15 && p.minute === 0 && p.weekday === 4);
assert("Google local string bez UTC posunu", toGoogleLocalDateTime(summer) === "2026-06-04T15:00:00", toGoogleLocalDateTime(summer));
assert("formatBratislava čitateľný", formatBratislava(summer).includes("4. 6. 2026 o 15:00"), formatBratislava(summer));

// 3) Working-hours window for a date (2026-06-04 is a Thursday).
const win = windowForDate(workingHours, { year: 2026, month: 6, day: 4 });
assert("Štvrtok otvorený 09:00–17:00", win.open && win.fromMin === 540 && win.toMin === 1020);

// 4) Slot checks. Service 30 min + buffer 10 min. "now" = 2026-06-04 08:00 local.
const now = zonedToUtc(2026, 6, 4, 8, 0);
const date = { year: 2026, month: 6, day: 4 };
// Busy 15:00–17:00 local (a private event the AI must only see as "busy").
const busy: BusyRange[] = [{ start: zonedToUtc(2026, 6, 4, 15, 0), end: zonedToUtc(2026, 6, 4, 17, 0) }];

const free10 = checkSlot({ date, startMin: 10 * 60, durationMin: 30, bufferMin: 10, window: win, busy, now });
assert("10:00 voľný", free10.ok);

const busy1500 = checkSlot({ date, startMin: 15 * 60, durationMin: 30, bufferMin: 10, window: win, busy, now });
assert("15:00 obsadený (prekrýva private event)", !busy1500.ok && busy1500.reason === "busy");

// 14:40 + 30min service = 15:10 → overlaps the 15:00 busy start → taken.
const busy1440 = checkSlot({ date, startMin: 14 * 60 + 40, durationMin: 30, bufferMin: 10, window: win, busy, now });
assert("14:40 obsadený (presahuje do 15:00)", !busy1440.ok && busy1440.reason === "busy");

// 14:00 + 30 + 10 buffer = 14:40 ≤ 15:00 → free.
const free1400 = checkSlot({ date, startMin: 14 * 60, durationMin: 30, bufferMin: 10, window: win, busy, now });
assert("14:00 voľný (vrátane 10 min buffer pred 15:00)", free1400.ok);

// 16:50 service end 17:20 > 17:00 close → outside hours.
const late = checkSlot({ date, startMin: 16 * 60 + 50, durationMin: 30, bufferMin: 10, window: win, busy, now });
assert("16:50 mimo otváracích hodín", !late.ok && late.reason === "outside_hours");

// 5) freeSlotsForDay excludes the 15:00–17:00 block.
const slots = freeSlotsForDay({ date, durationMin: 30, bufferMin: 10, workingHours, busy, now });
assert("Zoznam voľných časov neponúka 15:00/15:30/16:00", !slots.includes("15:00") && !slots.includes("15:30") && !slots.includes("16:00"), slots.join(" "));
assert("Zoznam voľných časov ponúka 09:00", slots.includes("09:00"), slots.join(" "));

// 6) Nearest slot from a taken 15:00 → should jump past the busy block (≥17:00 needs hours; same day closes 17:00 so next is the next open day).
const nearest = findNearestSlot({ fromInstant: zonedToUtc(2026, 6, 4, 15, 0), durationMin: 30, bufferMin: 10, workingHours, busy, now });
const nearestStr = nearest ? `${nearest.date.year}-${nearest.date.month}-${nearest.date.day} ${nearest.time}` : "null";
assert("Najbližší voľný po 15:00 existuje", nearest !== null, nearestStr);
// 15:00–17:00 is busy and the day closes at 17:00 → nearest must be a later day, not the busy window.
const sameThuBusy = nearest?.date.day === 4 && ["15:00", "15:30", "16:00", "16:30"].includes(nearest?.time ?? "");
assert("Najbližší voľný nie je v obsadenom okne", !sameThuBusy, nearestStr);
assert("Najbližší voľný je nasledujúci deň (piatok 5.) o 09:00", nearest?.date.day === 5 && nearest?.time === "09:00", nearestStr);

// 7) Sunday is closed → no slots.
const sundaySlots = freeSlotsForDay({ date: { year: 2026, month: 6, day: 7 }, durationMin: 30, bufferMin: 10, workingHours, busy: [], now });
assert("Nedeľa zatvorená → žiadne sloty", sundaySlots.length === 0);

console.log(failures === 0 ? "\nVŠETKY TESTY PREŠLI ✅" : `\n${failures} TEST(OV) ZLYHALO ❌`);
process.exit(failures === 0 ? 0 : 1);
