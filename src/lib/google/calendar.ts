// Google Calendar REST client (raw fetch). Operates on the barber's PRIMARY
// calendar only. Handles automatic access-token refresh and persists refreshed
// tokens back to Barber.googleCalendarTokens.
//
// PRIVACY (critical): availability is read via the **freeBusy** endpoint, which
// returns ONLY busy {start,end} ranges — never event titles/descriptions. We
// must never call events.list for reading availability, so a private event can
// only ever surface to the AI as an opaque "busy 15:00–17:00".

import { prisma } from "@/lib/prisma";
import { TIMEZONE } from "@/lib/booking/timezone";
import {
  parseStoredTokens,
  refreshAccessToken,
  type GoogleCalendarTokens,
} from "./oauth";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const PRIMARY = "primary";

/** Raised when the barber has not connected Google Calendar. Callers degrade gracefully. */
export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google Kalendár nie je pripojený.");
    this.name = "GoogleNotConnectedError";
  }
}

/** Raised when a Google API call fails (network / API error). */
export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type BusyRange = { start: Date; end: Date };

/**
 * Return a valid (non-expired) access token for the barber, refreshing via the
 * refresh_token when needed and persisting the new token. Throws
 * GoogleNotConnectedError if the barber has no stored tokens.
 */
export async function getValidAccessToken(barber: {
  id: string;
  googleCalendarTokens: unknown;
}): Promise<string> {
  const tokens = parseStoredTokens(barber.googleCalendarTokens);
  if (!tokens) throw new GoogleNotConnectedError();

  // Still valid (expiry already carries a 60s safety margin).
  if (tokens.expiry > Date.now()) return tokens.access_token;

  // Expired → refresh, keeping the existing refresh_token.
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  const updated: GoogleCalendarTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry: refreshed.expiry,
    scope: refreshed.scope ?? tokens.scope,
    token_type: refreshed.token_type ?? tokens.token_type,
  };
  await prisma.barber
    .update({ where: { id: barber.id }, data: { googleCalendarTokens: updated } })
    .catch((e) => console.warn(`[google] uloženie obnoveného tokenu zlyhalo: ${e?.code ?? e}`));
  console.log(`[google] access token obnovený pre barbera ${barber.id}`);
  return refreshed.access_token;
}

async function calFetch<T = any>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${CAL_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: any;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = data?.error?.message ?? `Google ${res.status}`;
    console.error(`[google] ${init.method ?? "GET"} ${path} -> ${res.status}: ${msg}`);
    throw new GoogleApiError(res.status, msg, text);
  }
  return data as T;
}

/**
 * (B) Busy ranges on the PRIMARY calendar between two UTC instants.
 * Returns ONLY {start,end} — no titles ever leave Google. The AI never sees more.
 */
export async function getBusyRanges(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyRange[]> {
  const data = await calFetch<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(
    accessToken,
    "/freeBusy",
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: TIMEZONE,
        items: [{ id: PRIMARY }],
      }),
    },
  );
  const busy = data.calendars?.[PRIMARY]?.busy ?? [];
  return busy
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((b) => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()));
}

/**
 * (C) Create an event on the PRIMARY calendar. `localStart`/`localEnd` are naive
 * Bratislava wall-clock strings ("2026-06-04T15:00:00"); paired with timeZone so
 * Google stores the correct instant (fixes the earlier UTC bug). Returns event id.
 */
export async function createEvent(
  accessToken: string,
  opts: { summary: string; localStart: string; localEnd: string; description?: string },
): Promise<string> {
  const data = await calFetch<{ id?: string }>(accessToken, `/calendars/${PRIMARY}/events`, {
    method: "POST",
    body: JSON.stringify({
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.localStart, timeZone: TIMEZONE },
      end: { dateTime: opts.localEnd, timeZone: TIMEZONE },
    }),
  });
  if (!data.id) throw new GoogleApiError(500, "Google nevrátil ID vytvorenej udalosti.");
  return data.id;
}

/**
 * (E) Delete an event by id. A 404/410 (already gone) is treated as success so
 * cancel/reschedule stay idempotent.
 */
export async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  try {
    await calFetch(accessToken, `/calendars/${PRIMARY}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) {
      console.warn(`[google] udalosť ${eventId} už neexistuje (status ${e.status}) — pokračujem.`);
      return;
    }
    throw e;
  }
}
