import { Prisma, PrismaClient } from "@prisma/client";
// Relative import (tsx does not resolve the "@/..." tsconfig alias).
import { DEFAULT_WORKING_HOURS } from "../src/lib/days";

const prisma = new PrismaClient();

// Idempotent: one fully-onboarded example barber for quick local testing.
async function main() {
  const email = "demo@barberai.sk";

  const barber = await prisma.barber.upsert({
    where: { email },
    update: {},
    create: {
      businessName: "Demo Barber Shop",
      phone: "+421 900 123 456",
      email,
      address: "Hlavná 1, 811 01 Bratislava",
      workingHours: DEFAULT_WORKING_HOURS as unknown as Prisma.InputJsonValue,
      bufferMin: 10,
      aiStyle: "Ahoj! Jasné, kľudne príď 💈 Daj vedieť, keby niečo. Vidíme sa!",
      onboardingStep: 5,
      onboardingComplete: true,
      services: {
        create: [
          { name: "Pánsky strih", durationMin: 30, priceEur: "15.00" },
          { name: "Strih + brada", durationMin: 45, priceEur: "22.00" },
          { name: "Úprava brady", durationMin: 20, priceEur: "10.00" },
        ],
      },
    },
  });

  console.log(`Seed OK — barber: ${barber.businessName} (${barber.email})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
