import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadCurrentBarber } from "@/lib/barber";
import { prisma } from "@/lib/prisma";
import { DAY_KEYS, DAY_LABELS, normalizeWorkingHours } from "@/lib/days";
import { formatDateTime, formatDuration, formatEur } from "@/lib/format";
import { ConnectInstagramButton } from "@/components/dashboard/ConnectInstagramButton";
import { LearnStyleButton } from "@/components/dashboard/LearnStyleButton";
import { NotificationCard } from "@/components/dashboard/NotificationCard";

const NOTIF_LABEL: Record<string, string> = {
  AI_UNSURE: "AI si nie je istá",
  PRICE_GUARD: "Kontrola ceny",
  AI_ERROR: "Chyba spracovania",
};

const SENDER_LABEL: Record<string, string> = {
  CUSTOMER: "Zákazník",
  AI: "AI",
  BARBER: "Vy",
};

// ── Small presentational helpers (server components) ─────────────────────────
function Badge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${
        ok
          ? "bg-green-50 text-green-700 ring-green-200"
          : "bg-slate-100 text-slate-500 ring-slate-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-500" : "bg-slate-400"}`} />
      {label}
    </span>
  );
}

function Section({
  title,
  editStep,
  action,
  children,
}: {
  title: string;
  editStep?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {editStep !== undefined && (
          <Link
            href={`/onboarding?step=${editStep}`}
            className="text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            Upraviť
          </Link>
        )}
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { ig?: string };
}) {
  const barber = await loadCurrentBarber();
  if (!barber || !barber.onboardingComplete) redirect("/onboarding");

  const [notifications, conversations] = await Promise.all([
    prisma.notification.findMany({
      where: { barberId: barber.id, read: false },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { conversation: true },
    }),
    prisma.conversation.findMany({
      where: { barberId: barber.id },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);

  const hours = normalizeWorkingHours(barber.workingHours);
  const instagramConnected = Boolean(barber.instagramAccountId);
  const calendarConnected = barber.googleCalendarTokens != null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      {/* Top bar */}
      <header className="mb-8 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">
          Barber<span className="text-brand-600">AI</span>
        </span>
        <form action="/api/logout" method="post">
          <button type="submit" className="text-sm font-medium text-slate-500 hover:text-slate-800">
            Odhlásiť
          </button>
        </form>
      </header>

      {searchParams.ig === "success" && (
        <div className="mb-5 rounded-lg bg-green-50 p-3 text-sm text-green-700 ring-1 ring-green-100">
          Instagram bol úspešne pripojený. 🎉
        </div>
      )}
      {searchParams.ig === "failure" && (
        <div className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-100">
          Pripojenie Instagramu sa nepodarilo. Skúste to znova.
        </div>
      )}

      <div className="space-y-5">
        {/* Notifications — needs the barber's attention */}
        {notifications.length > 0 && (
          <Section
            title="Vyžaduje vašu pozornosť"
            action={
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {notifications.length}
              </span>
            }
          >
            <div className="space-y-3">
              {notifications.map((n) => (
                <NotificationCard
                  key={n.id}
                  id={n.id}
                  typeLabel={NOTIF_LABEL[n.type] ?? n.type}
                  message={n.message}
                  draftReply={n.draftReply}
                  customerHandle={n.conversation?.customerHandle ?? null}
                  createdAt={formatDateTime(n.createdAt)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Profile */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{barber.businessName}</h1>
              <p className="mt-1 text-sm text-slate-500">{barber.address}</p>
            </div>
            <Link
              href="/onboarding?step=1"
              className="shrink-0 text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              Upraviť
            </Link>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Telefón</dt>
              <dd className="text-sm text-slate-700">{barber.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">E-mail</dt>
              <dd className="text-sm text-slate-700">{barber.email}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge
              label={`Instagram: ${instagramConnected ? "pripojený" : "nepripojený"}`}
              ok={instagramConnected}
            />
            <Badge
              label={`Kalendár: ${calendarConnected ? "pripojený" : "nepripojený"}`}
              ok={calendarConnected}
            />
          </div>
        </section>

        {/* Instagram connection */}
        <Section title="Instagram">
          {instagramConnected ? (
            <p className="text-sm text-slate-600">
              Instagram je pripojený — AI odpovedá zákazníkom v správach automaticky.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-slate-500">
                Pripojte svoj Instagram, aby AI mohla odpovedať zákazníkom vo vašom mene.
              </p>
              <ConnectInstagramButton />
            </>
          )}
        </Section>

        {/* Working hours */}
        <Section title="Pracovný čas" editStep={2}>
          <table className="w-full text-sm">
            <tbody>
              {DAY_KEYS.map((key) => (
                <tr key={key} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium text-slate-700">{DAY_LABELS[key]}</td>
                  <td className="py-2 text-right text-slate-600">
                    {hours[key].open ? (
                      `${hours[key].from} – ${hours[key].to}`
                    ) : (
                      <span className="text-slate-400">Zatvorené</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-slate-500">
            Prestávka medzi zákazníkmi:{" "}
            <span className="font-medium text-slate-700">{barber.bufferMin} min</span>
          </p>
        </Section>

        {/* Services */}
        <Section title="Služby" editStep={3}>
          {barber.services.length === 0 ? (
            <p className="text-sm text-slate-400">Žiadne služby.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {barber.services.map((service) => (
                <li key={service.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-medium text-slate-800">{service.name}</p>
                    <p className="text-xs text-slate-500">{formatDuration(service.durationMin)}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatEur(service.priceEur.toString())}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* AI style */}
        <Section title="Štýl AI" editStep={5}>
          {barber.aiStyle ? (
            <p className="text-sm text-slate-600">{barber.aiStyle}</p>
          ) : (
            <p className="text-sm text-slate-400">Štýl zatiaľ nie je nastavený.</p>
          )}
          <div className="mt-4">
            <LearnStyleButton disabled={!instagramConnected} />
          </div>
        </Section>

        {/* Conversations */}
        <Section title="Konverzácie">
          {conversations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
              <p className="text-sm text-slate-400">Zatiaľ žiadne konverzácie.</p>
              <p className="mt-1 text-xs text-slate-400">
                Po pripojení Instagramu sa tu zobrazia správy od zákazníkov.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {conversations.map((c) => {
                const last = c.messages[0];
                return (
                  <li key={c.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-800">
                        {c.customerName ? c.customerName : `@${c.customerHandle}`}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.controlledBy === "AI"
                            ? "bg-brand-50 text-brand-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {c.controlledBy === "AI" ? "AI" : "Vy"}
                      </span>
                    </div>
                    {last && (
                      <p className="mt-1 truncate text-sm text-slate-500">
                        <span className="text-slate-400">{SENDER_LABEL[last.sender]}: </span>
                        {last.text}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}
