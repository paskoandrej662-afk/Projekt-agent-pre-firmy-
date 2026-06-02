// Slovak-locale formatting helpers.

const eurFormatter = new Intl.NumberFormat("sk-SK", {
  style: "currency",
  currency: "EUR",
});

/** Format a price (number or Prisma Decimal / string) as e.g. "12,00 €". */
export function formatEur(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  return eurFormatter.format(Number.isFinite(n) ? n : 0);
}

/** Format a duration in minutes as a short Slovak label, e.g. "45 min" or "1 h 30 min". */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("sk-SK", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Format a date/time in Slovak locale, e.g. "01.06. 14:05". */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value));
}
