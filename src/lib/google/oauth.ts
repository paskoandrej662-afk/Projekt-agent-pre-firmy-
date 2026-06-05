// Google OAuth 2.0 — minimal, dependency-free (raw fetch, mirrors src/lib/unipile.ts).
// We only need the calendar scope with offline access (so Google returns a
// refresh_token we can use to mint new access tokens for ~1h-expiring tokens).
// Secrets come from env: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Read+write access to the barber's calendars (we use the PRIMARY calendar).
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Tokens we persist in Barber.googleCalendarTokens (JSON). */
export type GoogleCalendarTokens = {
  access_token: string;
  refresh_token: string;
  /** Absolute expiry as epoch milliseconds. */
  expiry: number;
  scope?: string;
  token_type?: string;
};

function config(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Chýba konfigurácia Google OAuth (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI).",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Is Google OAuth configured at all? (Lets the UI/AI degrade gracefully.) */
export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI,
  );
}

/**
 * Build the consent URL. `state` carries the barber id (verified against the
 * session cookie in the callback) for CSRF protection.
 * - access_type=offline + prompt=consent → guarantees a refresh_token, even on
 *   re-connect (Google only returns refresh_token on first consent otherwise).
 */
export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Google token endpoint zlyhal: ${detail}`);
  }
  return data;
}

// Helper: seconds-from-now → epoch ms expiry, with a 60s safety margin.
function expiryFrom(expiresInSec: number | undefined): number {
  const seconds = typeof expiresInSec === "number" ? expiresInSec : 3600;
  return Date.now() + Math.max(0, seconds - 60) * 1000;
}

/** Exchange the one-time auth `code` for tokens (initial connect). */
export async function exchangeCodeForTokens(code: string): Promise<GoogleCalendarTokens> {
  const { clientId, clientSecret, redirectUri } = config();
  const data = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Google nevrátil access_token alebo refresh_token (chýba offline súhlas).");
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: expiryFrom(data.expires_in),
    scope: data.scope,
    token_type: data.token_type,
  };
}

/**
 * Use the long-lived refresh_token to mint a fresh access_token. Google does NOT
 * return a new refresh_token here, so we carry the old one forward.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<Omit<GoogleCalendarTokens, "refresh_token">> {
  const { clientId, clientSecret } = config();
  const data = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!data.access_token) throw new Error("Obnova Google tokenu nevrátila access_token.");
  return {
    access_token: data.access_token,
    expiry: expiryFrom(data.expires_in),
    scope: data.scope,
    token_type: data.token_type,
  };
}

/** Narrow stored JSON (Prisma `Json?`) into GoogleCalendarTokens, or null. */
export function parseStoredTokens(raw: unknown): GoogleCalendarTokens | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.access_token !== "string" || typeof t.refresh_token !== "string") return null;
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expiry: typeof t.expiry === "number" ? t.expiry : 0,
    scope: typeof t.scope === "string" ? t.scope : undefined,
    token_type: typeof t.token_type === "string" ? t.token_type : undefined,
  };
}
