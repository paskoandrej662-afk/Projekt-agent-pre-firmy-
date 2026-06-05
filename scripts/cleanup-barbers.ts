// One-off cleanup: collapse the test barbers down to the single real one.
//
// Keeps the barber with KEEP_EMAIL, sets its Unipile Instagram account id, and
// deletes every other barber together with all records that hang off it
// (messages → bookings → notifications → conversations → services → barber).
// DB-level cascades would handle most of this, but we delete explicitly and in
// dependency order so the run is auditable and reports exact counts.
//
// Dry run (default): npx tsx scripts/cleanup-barbers.ts
// Apply changes:     npx tsx scripts/cleanup-barbers.ts --apply
import fs from "fs";

// tsx doesn't load .env automatically — do it the same way the other scripts do.
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}

import { prisma } from "@/lib/prisma";

const KEEP_EMAIL = "paskoandrej4@gmail.com";
const KEEP_ID_PREFIX = "cmq01jint";
const NEW_INSTAGRAM_ACCOUNT_ID = "wGNFvmOaQcGdCh17yLdmaQ";

const APPLY = process.argv.includes("--apply");

async function main() {
  const keeper = await prisma.barber.findUnique({ where: { email: KEEP_EMAIL } });
  if (!keeper) {
    throw new Error(`Keeper barber with email ${KEEP_EMAIL} not found — aborting, nothing changed.`);
  }
  if (!keeper.id.startsWith(KEEP_ID_PREFIX)) {
    throw new Error(
      `Safety check failed: keeper id ${keeper.id} does not start with "${KEEP_ID_PREFIX}" — aborting.`,
    );
  }

  const doomed = await prisma.barber.findMany({
    where: { id: { not: keeper.id } },
    select: { id: true, email: true, businessName: true },
    orderBy: { createdAt: "asc" },
  });
  const doomedIds = doomed.map((b) => b.id);

  const convoIds = (
    await prisma.conversation.findMany({
      where: { barberId: { in: doomedIds } },
      select: { id: true },
    })
  ).map((c) => c.id);

  // Count what we're about to remove (works the same for dry run and apply).
  const counts = {
    messages: await prisma.message.count({ where: { conversationId: { in: convoIds } } }),
    bookings: await prisma.booking.count({ where: { barberId: { in: doomedIds } } }),
    notifications: await prisma.notification.count({ where: { barberId: { in: doomedIds } } }),
    conversations: convoIds.length,
    services: await prisma.service.count({ where: { barberId: { in: doomedIds } } }),
    barbers: doomedIds.length,
  };

  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no changes)"}\n`);
  console.log(`Keeper: ${keeper.id}  ${keeper.email}  (${keeper.businessName})`);
  console.log(
    `  instagramAccountId: ${keeper.instagramAccountId ?? "(null)"} -> ${NEW_INSTAGRAM_ACCOUNT_ID}` +
      (keeper.instagramAccountId === NEW_INSTAGRAM_ACCOUNT_ID ? "  (already set)" : ""),
  );
  console.log(`\nBarbers to delete (${doomed.length}):`);
  for (const b of doomed) console.log(`  - ${b.id}  ${b.email}  (${b.businessName})`);
  console.log(`\nRelated records to delete:`);
  console.log(`  messages=${counts.messages} bookings=${counts.bookings} notifications=${counts.notifications} conversations=${counts.conversations} services=${counts.services}`);

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to perform the deletion.`);
    return;
  }

  // Delete children before parents (bookings before services for the
  // Booking->Service RESTRICT FK), then update the keeper — all atomic.
  const result = await prisma.$transaction(async (tx) => {
    const messages = await tx.message.deleteMany({ where: { conversationId: { in: convoIds } } });
    const bookings = await tx.booking.deleteMany({ where: { barberId: { in: doomedIds } } });
    const notifications = await tx.notification.deleteMany({ where: { barberId: { in: doomedIds } } });
    const conversations = await tx.conversation.deleteMany({ where: { barberId: { in: doomedIds } } });
    const services = await tx.service.deleteMany({ where: { barberId: { in: doomedIds } } });
    const barbers = await tx.barber.deleteMany({ where: { id: { in: doomedIds } } });
    const updated = await tx.barber.update({
      where: { id: keeper.id },
      data: { instagramAccountId: NEW_INSTAGRAM_ACCOUNT_ID },
    });
    return { messages, bookings, notifications, conversations, services, barbers, updated };
  });

  console.log(`\n✅ Deleted:`);
  console.log(`  messages=${result.messages.count} bookings=${result.bookings.count} notifications=${result.notifications.count} conversations=${result.conversations.count} services=${result.services.count} barbers=${result.barbers.count}`);
  console.log(`✅ Keeper updated: ${result.updated.id}  instagramAccountId=${result.updated.instagramAccountId}`);

  const remaining = await prisma.barber.findMany({
    select: { id: true, email: true, instagramAccountId: true },
  });
  console.log(`\nRemaining barbers (${remaining.length}):`);
  for (const b of remaining) console.log(`  - ${b.id}  ${b.email}  instagramAccountId=${b.instagramAccountId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
