// Thin, defensive wrapper over the Unipile API (white-label: the barber never
// sees Unipile). Base URL comes from UNIPILE_DSN, auth from UNIPILE_API_KEY.
// All endpoints live under /api/v1. Errors are logged and thrown as UnipileError.

const API_VERSION = "/api/v1";

function baseUrl(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error("Chýba premenná prostredia UNIPILE_DSN.");
  const trimmed = dsn.trim().replace(/\/+$/, "");
  // DSN is typically `subdomain.unipile.com:port` with no scheme.
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function apiKey(): string {
  const key = process.env.UNIPILE_API_KEY;
  if (!key) throw new Error("Chýba premenná prostredia UNIPILE_API_KEY.");
  return key;
}

export class UnipileError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = "UnipileError";
  }
}

// `silent` suppresses the error log for expected failures (e.g. a 404 we handle
// by resolving the chat id). The caller logs cleanly instead.
type FetchOpts = Omit<RequestInit, "body"> & { json?: unknown; form?: FormData; silent?: boolean };

async function unipileFetch<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const { json, form, silent, ...rest } = opts;
  const headers = new Headers(rest.headers);
  headers.set("X-API-KEY", apiKey());
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // let fetch set the multipart boundary
  }

  const res = await fetch(`${baseUrl()}${API_VERSION}${path}`, { ...rest, headers, body });
  const text = await res.text();
  let data: any = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (!silent) {
      console.error(
        `[unipile] ${rest.method ?? "GET"} ${path} -> ${res.status}`,
        typeof data === "string" ? data : JSON.stringify(data),
      );
    }
    throw new UnipileError(res.status, `Unipile ${res.status}`, text);
  }
  return data as T;
}

// ── Hosted auth (Instagram connect) ──────────────────────────────────────────
export async function createHostedAuthLink(opts: {
  barberId: string;
  successUrl: string;
  failureUrl: string;
  notifyUrl: string;
  expiresOn: string; // ISO 8601, short-lived
}): Promise<{ url: string }> {
  const data = await unipileFetch<{ url: string }>("/hosted/accounts/link", {
    method: "POST",
    json: {
      type: "create",
      providers: ["INSTAGRAM"],
      api_url: baseUrl(),
      expiresOn: opts.expiresOn,
      name: opts.barberId, // echoed back to notify_url so we can match the account
      success_redirect_url: opts.successUrl,
      failure_redirect_url: opts.failureUrl,
      notify_url: opts.notifyUrl,
    },
  });
  return { url: data.url };
}

// ── Webhook registration ─────────────────────────────────────────────────────
export async function createMessagingWebhook(opts: {
  requestUrl: string;
  accountId: string;
  name: string;
}): Promise<void> {
  await unipileFetch("/webhooks", {
    method: "POST",
    json: {
      source: "messaging",
      request_url: opts.requestUrl,
      name: opts.name,
      format: "json",
      events: ["message_received"],
      account_ids: [opts.accountId],
    },
  });
}

// ── Sending a reply ──────────────────────────────────────────────────────────
// Two strategies, per Unipile support + docs:
//   "reply"    → POST /chats/{chat_id}/messages  (we already have a known chat)
//   "new_chat" → POST /chats with attendees_ids = the customer's
//                provider_messaging_id, resolved via GET /users/{identifier}.
export type SendStrategy = "reply" | "new_chat";

// Low-level: send into a KNOWN chat (multipart/form-data, not JSON).
// Docs: chatscontroller_sendmessageinchat → POST /api/v1/chats/{chat_id}/messages,
// form fields `text` + `account_id`; success returns `{ message_id }`.
async function sendInChat(
  accountId: string,
  chatId: string,
  text: string,
  silent: boolean,
): Promise<string | null> {
  const form = new FormData();
  form.append("text", text);
  form.append("account_id", accountId);
  const data = await unipileFetch<{ message_id?: string; id?: string }>(
    `/chats/${encodeURIComponent(chatId)}/messages`,
    { method: "POST", form, silent },
  );
  return data?.message_id ?? data?.id ?? null;
}

// Profile object from GET /users/{identifier}. We only need provider_messaging_id
// (the id Instagram chats must be addressed by); kept open for the other fields.
export type UnipileProfile = {
  provider_messaging_id?: string;
  provider_id?: string;
  public_identifier?: string;
  [k: string]: unknown;
};

// Retrieve a profile by identifier — the identifier may be the provider's internal
// id (webhook `attendee_provider_id`) OR the public id (the @handle).
// Docs: userscontroller_getprofilebyidentifier →
//   GET /api/v1/users/{identifier}?account_id={account_id}
export async function retrieveProfile(
  accountId: string,
  identifier: string,
  silent = false,
): Promise<UnipileProfile> {
  const qs = new URLSearchParams({ account_id: accountId });
  return unipileFetch<UnipileProfile>(
    `/users/${encodeURIComponent(identifier)}?${qs.toString()}`,
    { method: "GET", silent },
  );
}

// Pull provider_messaging_id out of a profile, defensively (docs render the
// response schema client-side, so we can't 100%-pin the path from the reference).
// We check the documented top-level field, then a couple of plausible nestings,
// and log the available keys if we still can't find it — so the first live test
// reveals the exact shape instead of failing opaquely.
function extractMessagingId(profile: UnipileProfile): string | null {
  const direct = profile?.provider_messaging_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  // Be lenient about nesting / naming variants seen across Unipile providers.
  const nests = [profile?.messaging, profile?.instagram, (profile as any)?.data].filter(Boolean) as any[];
  for (const n of nests) {
    const v = n?.provider_messaging_id ?? n?.messaging_id;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  console.warn(
    "[unipile] provider_messaging_id nenájdené v profile; dostupné kľúče:",
    Object.keys(profile ?? {}).join(", ") || "(žiadne)",
  );
  return null;
}

// Resolve the customer's provider_messaging_id by trying each known identifier
// (provider id first, then the @handle) against the Retrieve-a-profile endpoint.
// Returns the messaging id + which identifier resolved it (for logging).
export async function resolveMessagingId(
  accountId: string,
  identifiers: Array<string | null | undefined>,
): Promise<{ messagingId: string | null; via: string | null }> {
  const tried = new Set<string>();
  for (const identifier of identifiers) {
    if (!identifier || tried.has(identifier)) continue;
    tried.add(identifier);
    try {
      const profile = await retrieveProfile(accountId, identifier, true);
      const messagingId = extractMessagingId(profile);
      if (messagingId) return { messagingId, via: identifier };
    } catch (e) {
      if (!(e instanceof UnipileError)) throw e;
      console.warn(`[unipile] profil pre "${identifier}" zlyhal: ${e.message}`);
    }
  }
  return { messagingId: null, via: null };
}

// Start a NEW chat. attendees_ids MUST be the provider_messaging_id (NOT the
// webhook's attendee_provider_id / @handle) for Instagram.
// Docs: chatscontroller_startnewchat → POST /api/v1/chats (multipart),
//   form fields `account_id`, `attendees_ids` (repeated, one per attendee), `text`.
// Success (201) returns the canonical chat id — persist it for future replies.
export async function startChat(
  accountId: string,
  messagingId: string,
  text: string,
): Promise<{ chatId: string | null; messageId: string | null }> {
  const form = new FormData();
  form.append("account_id", accountId);
  form.append("attendees_ids", messagingId); // repeated form field, one per value
  form.append("text", text);
  const data = await unipileFetch<{ chat_id?: string; id?: string; message_id?: string }>("/chats", {
    method: "POST",
    form,
  });
  return { chatId: data?.chat_id ?? data?.id ?? null, messageId: data?.message_id ?? null };
}

/**
 * Robust reply (corrected per Unipile support):
 *   a) Known chat → "reply"   : POST /chats/{chat_id}/messages.
 *   b) Otherwise  → "new_chat": resolve provider_messaging_id via the profile
 *      endpoint, then POST /chats with attendees_ids = provider_messaging_id.
 * A known chat that fails (e.g. a brand-new, unsynced webhook chat_id that 404s)
 * falls back to (b). Returns the canonical chat id that worked (persist it) +
 * which strategy won. Throws only if every applicable path fails — the caller
 * then notifies the barber so the drafted reply is never lost.
 */
export async function sendReply(opts: {
  accountId: string;
  chatId: string | null;
  attendeeProviderId: string | null;
  publicIdentifier?: string | null;
  text: string;
}): Promise<{ messageId: string | null; chatId: string | null; strategy: SendStrategy }> {
  const { accountId, chatId, attendeeProviderId, publicIdentifier, text } = opts;
  let lastError: unknown;

  // a) Reply into a chat we already know.
  if (chatId) {
    try {
      const messageId = await sendInChat(accountId, chatId, text, true);
      console.log(`[unipile] stratégia=reply do známeho chatu ${chatId}`);
      return { messageId, chatId, strategy: "reply" };
    } catch (e) {
      if (!(e instanceof UnipileError)) throw e;
      lastError = e;
      // Likely a brand-new/unsynced chat_id → fall through to start a new chat.
      console.warn(`[unipile] reply do chatu ${chatId} zlyhal (${e.message}); skúšam nový chat`);
    }
  }

  // b) Start a new chat: resolve the provider_messaging_id, then POST /chats.
  const { messagingId, via } = await resolveMessagingId(accountId, [attendeeProviderId, publicIdentifier]);
  if (messagingId) {
    console.log(
      `[unipile] stratégia=new_chat; provider_messaging_id=${messagingId} (z identifikátora "${via}")`,
    );
    const res = await startChat(accountId, messagingId, text);
    if (res.chatId) console.log(`[unipile] nový chat vytvorený: chat_id=${res.chatId}`);
    return { messageId: res.messageId, chatId: res.chatId ?? chatId, strategy: "new_chat" };
  }

  throw (
    lastError ??
    new UnipileError(
      404,
      "Žiadny spôsob odoslania nevyšiel: nepodarilo sa zistiť provider_messaging_id (chýba chat aj profil).",
    )
  );
}

// ── Reading the barber's own sent messages (for style learning) ──────────────
export type UnipileMessage = { id: string; text: string | null; is_sender: number };

export async function listSentMessages(accountId: string, max = 100): Promise<UnipileMessage[]> {
  const out: UnipileMessage[] = [];
  let cursor: string | null = null;

  // Paginate; the REST message object exposes is_sender (1 = the connected
  // account itself). There is no documented is_sender query filter, so filter here.
  for (let page = 0; page < 20 && out.length < max; page++) {
    const qs = new URLSearchParams({ account_id: accountId, limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const data = await unipileFetch<{ items?: any[]; cursor?: string | null }>(
      `/messages?${qs.toString()}`,
      { method: "GET" },
    );
    const items = data?.items ?? [];
    for (const m of items) {
      if (m.is_sender === 1 && typeof m.text === "string" && m.text.trim()) {
        out.push({ id: m.id, text: m.text, is_sender: 1 });
        if (out.length >= max) break;
      }
    }
    cursor = data?.cursor ?? null;
    if (!cursor || items.length === 0) break;
  }
  return out;
}
