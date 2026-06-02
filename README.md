# BarberAI

Multi-tenant SaaS pre barberov.

- **Krok 1 (základ):** onboarding sprievodca, databázová schéma, dashboard.
- **Krok 2 (AI + Instagram):** pripojenie Instagramu cez Unipile, prijímanie správ
  cez webhook, AI odpovede v štýle barbera s prísnou ochranou proti halucináciám,
  učenie štýlu z reálnych správ a notifikácie pre barbera, keď si AI nie je istá.
- Rezervácie/kalendár prídu v ďalšom kroku (schéma ich už podporuje).

## Tech stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS**
- **PostgreSQL na Supabase** cez **Prisma ORM**
- Tajomstvá sa čítajú z `.env` (`DATABASE_URL` pooled, `DIRECT_URL` priame pripojenie)

## Spustenie lokálne

```bash
# 1) Inštalácia závislostí
npm install

# 2) Vygenerovanie Prisma klienta
npm run db:generate

# 3) Vytvorenie tabuliek v Supabase (migrácia)
npm run db:migrate -- --name init

# 4) (voliteľné) Naplnenie ukážkovými dátami
npm run db:seed

# 5) Štart vývojového servera
npm run dev
```

Aplikácia beží na **http://localhost:3000** a presmeruje na onboarding:
**http://localhost:3000/onboarding**

## Architektúra

- **Multi-tenancy**: každý záznam patrí barberovi cez `barberId`; indexy na
  `barberId`, `Message.conversationId` a `Booking.startTime`.
- **Identita**: v tomto kroku ju nesie `httpOnly` cookie `barber_id` (bez hesiel).
  API routy sú preto bezstavové a horizontálne škálovateľné. Pole `Barber.email`
  (unikátne) je pripravené na neskoršie pridanie prihlasovania.
- **Onboarding**: 5 krokov, postup sa ukladá po každom kroku (`onboardingStep`),
  takže po refreshi/páde sa pokračuje tam, kde používateľ skončil.
- **Validácia**: Zod schémy v `src/lib/validation.ts` sú zdieľané klientom aj
  serverom (jediný zdroj pravdy), chybové hlášky sú v slovenčine.

## Krok 2 — AI + Instagram

- **Pripojenie Instagramu (white-label):** tlačidlo „Pripojiť Instagram" na dashboarde
  spustí Unipile hosted auth (`POST /api/instagram/connect`). Po autorizácii Unipile
  zavolá `POST /api/instagram/notify`, kde uložíme `Barber.instagramAccountId` a
  zaregistrujeme webhook pre správy.
- **Webhook správ:** `POST /api/unipile/webhook` — idempotentný (provider `message_id`
  → `Message.externalId`), spracúva LEN správy od zákazníka (vlastné odchádzajúce ignoruje)
  a vždy vráti 200.
- **AI odpoveď:** Claude (`claude-sonnet-4-6`, konštanta v `src/lib/anthropic.ts`),
  vynútené tool-use → štruktúrované `{reply, confident, needs_barber, reason}`, prompt
  caching na systémovom prompte. FAKTY (názov, adresa, hodiny, služby/ceny) sú jediným
  zdrojom pravdy; štýl ovplyvňuje len AKO sa píše.
- **Ochrana proti halucináciám (viac vrstiev):** prísne pravidlá v systémovom prompte +
  confidence gate + kód-side price guard (cena mimo služieb → k barberovi). Keď si AI nie
  je istá, zákazníkovi neodpovie (voliteľne pošle „holding line") a vytvorí **notifikáciu**.
- **Učenie štýlu:** „Načítať môj štýl z Instagramu" stiahne posledné odoslané správy a
  uloží `aiStyle` + `aiTonePrefs`. Manuálne vloženie (krok 5 onboardingu) ostáva ako záloha.

### Potrebné premenné prostredia (krok 2)

`ANTHROPIC_API_KEY`, `UNIPILE_API_KEY`, `UNIPILE_DSN` (viď `.env.example`).
Voliteľne `APP_URL` (verejná URL pre webhooky) a `AI_HOLDING_LINE`.

### Rýchly test AI (bez Instagramu)

```bash
npx tsx scripts/ai-smoke.ts   # reálne volania Claude; overí štýl + anti-halucinácie
```

## Štruktúra

```
prisma/schema.prisma        # databázová schéma (Notification + Conversation polia pre IG)
src/lib/unipile.ts          # klient Unipile API (hosted auth, chats, send, webhooky)
src/lib/anthropic.ts        # Anthropic klient + konštanta modelu
src/lib/ai/                 # prompty (fakty+štýl), generovanie odpovede, price guard, štýl
src/lib/messaging.ts        # orchestrácia: generuj → guardy → pošli/notifikuj
src/app/api/instagram/      # connect, notify (callback), learn-style
src/app/api/unipile/webhook # prijímanie prichádzajúcich správ
src/app/api/notifications/  # označenie notifikácie ako vybavenej
src/app/dashboard/          # dashboard (IG, štýl, notifikácie, konverzácie)
src/components/dashboard/    # klientske tlačidlá + karta notifikácie
```
