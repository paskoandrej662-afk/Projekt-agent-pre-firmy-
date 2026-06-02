import { prisma } from "./prisma";
import { getBarberId } from "./session";

/**
 * Load the barber for the current session (from the cookie) together with their
 * services. Returns null when there is no session or the barber no longer exists.
 * Service order follows insertion (cuid ids are roughly time-sortable).
 */
export function loadCurrentBarber() {
  const id = getBarberId();
  if (!id) return Promise.resolve(null);
  return prisma.barber.findUnique({
    where: { id },
    include: { services: { orderBy: { id: "asc" } } },
  });
}
