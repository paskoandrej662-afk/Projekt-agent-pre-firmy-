// Smoke test for the AI reply logic. Run: npx tsx scripts/ai-smoke.ts
// Makes real Claude calls (needs ANTHROPIC_API_KEY in .env).
import fs from "fs";

// Load .env into process.env (tsx doesn't do this automatically).
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}

import { generateDraft, priceGuard, type HistoryMessage } from "@/lib/ai/reply";
import type { BarberFacts, ServiceFact } from "@/lib/ai/prompts";

const barber: BarberFacts = {
  businessName: "Demo Barber Shop",
  address: "Hlavná 1, Bratislava",
  phone: "+421 900 123 456",
  workingHours: {
    mon: { open: true, from: "09:00", to: "17:00" },
    fri: { open: true, from: "09:00", to: "17:00" },
    sat: { open: false, from: "09:00", to: "13:00" },
  },
  bufferMin: 10,
  aiStyle: "Píše neformálne, tyká, používa pár emoji 💈",
  aiTonePrefs: { formal: false, emojiLevel: "low" },
};

const services: ServiceFact[] = [
  { name: "Pánsky strih", durationMin: 30, priceEur: "15.00" },
  { name: "Strih + brada", durationMin: 45, priceEur: "22.00" },
  { name: "Úprava brady", durationMin: 20, priceEur: "10.00" },
];

const allowedPrices = services.map((s) => Number(s.priceEur));

async function run(label: string, customerText: string) {
  const history: HistoryMessage[] = [{ sender: "CUSTOMER", text: customerText }];
  const draft = await generateDraft(barber, services, history);
  const priceIssue = priceGuard(draft.reply, allowedPrices);
  console.log(`\n=== ${label} ===`);
  console.log(`Zákazník: ${customerText}`);
  console.log(`reply:        ${draft.reply}`);
  console.log(`confident:    ${draft.confident}`);
  console.log(`needs_barber: ${draft.needs_barber}`);
  console.log(`reason:       ${draft.reason}`);
  console.log(`priceGuard:   ${priceIssue ? "TRIPPED" : "ok"}`);
}

async function main() {
  await run("A) cena existujúcej služby", "Dobrý deň, koľko stojí pánsky strih?");
  await run("B) žiadosť o termín (booking)", "Máte voľný termín v piatok poobede?");
  await run("C) služba mimo faktov (farbenie)", "Robíte aj farbenie vlasov a koľko to stojí?");

  console.log("\n=== priceGuard (jednotkové testy) ===");
  console.log("18 € (neexistuje):", priceGuard("Pánsky strih je 18 €.", allowedPrices), "(očak. true)");
  console.log("15 € (existuje):  ", priceGuard("Pánsky strih je 15 €.", allowedPrices), "(očak. false)");
  console.log("bez ceny:         ", priceGuard("Otvorené do 17:00, strih trvá 30 min.", allowedPrices), "(očak. false)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
