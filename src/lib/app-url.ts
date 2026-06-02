// Derive the app's public base URL for callbacks/webhooks. In Codespaces this
// comes from the forwarded-host header (the public *.app.github.dev origin).
// Override with APP_URL when needed (e.g. a stable tunnel).
export function getAppBaseUrl(req: Request): string {
  const override = process.env.APP_URL;
  if (override) return override.replace(/\/+$/, "");

  const h = req.headers;
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Nepodarilo sa zistiť verejnú URL aplikácie.");
  return `${proto}://${host}`;
}
