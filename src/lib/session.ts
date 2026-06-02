import { cookies } from "next/headers";

// Tenant identity for this foundation step is carried by an httpOnly cookie.
// This keeps API routes stateless (no server-side session store) and lets the
// onboarding wizard resume after a refresh/crash. The unique `Barber.email`
// field keeps the door open for real authentication in a later step.
const COOKIE_NAME = "barber_id";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Read the current barber id from the request cookies (read-only — safe in RSC). */
export function getBarberId(): string | null {
  return cookies().get(COOKIE_NAME)?.value ?? null;
}

/** Set the barber id cookie. Only valid inside Route Handlers / Server Actions. */
export function setBarberId(id: string): void {
  cookies().set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR,
  });
}

/** Clear the barber id cookie. Only valid inside Route Handlers / Server Actions. */
export function clearBarberId(): void {
  cookies().delete(COOKIE_NAME);
}
