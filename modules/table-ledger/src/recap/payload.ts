// `table-ledger.postRecap` payload validation and pure text helpers. No Foundry globals.

export interface RecapPayload {
  session: number;
  date?: string;
  title: string;
  html: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_TITLE = 200;
const MAX_DATE = 64;
const MAX_HTML = 500_000;
const MAX_SESSION = 100_000;

export function validateRecap(data: unknown): Validation<RecapPayload> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, error: "payload must be an object" };
  const d = data as Record<string, unknown>;

  if (typeof d.session !== "number" || !Number.isInteger(d.session) || d.session < 0 || d.session > MAX_SESSION) {
    return { ok: false, error: "session must be a non-negative integer" };
  }
  if (typeof d.title !== "string" || !d.title.trim()) return { ok: false, error: "title must be a non-empty string" };
  const title = d.title.trim();
  if (title.length > MAX_TITLE) return { ok: false, error: `title is longer than ${MAX_TITLE} characters` };
  if (typeof d.html !== "string" || !d.html.trim()) return { ok: false, error: "html must be a non-empty string" };
  if (d.html.length > MAX_HTML) return { ok: false, error: `html is longer than ${MAX_HTML} characters` };

  const value: RecapPayload = { session: d.session, title, html: d.html };
  if (d.date !== undefined && d.date !== null && d.date !== "") {
    if (typeof d.date !== "string") return { ok: false, error: "date must be a string" };
    const date = d.date.trim();
    if (date.length > MAX_DATE) return { ok: false, error: `date is longer than ${MAX_DATE} characters` };
    if (date) value.date = date;
  }
  return { ok: true, value };
}

export function recapPageName(session: number, title: string): string {
  return `Session ${session} — ${title}`;
}

/** Page sort key so recap pages order by session number. */
export function recapPageSort(session: number): number {
  return session * 1000;
}

/** Content-link label: `{`, `}`, `[`, `]` would end the `@UUID[...]{...}` syntax early. */
export function linkLabel(text: string): string {
  return text.replace(/[{}[\]]/g, "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Plain-text preview of recap HTML for the chat card. */
export function excerpt(html: string, max = 280): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The GM form accepts HTML or plain text. Text without any tags becomes
 * paragraphs (blank-line separated, single newlines kept as `<br>`).
 */
export function textToHtml(input: string): string {
  if (/<[a-z][^>]*>/i.test(input)) return input;
  return input
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
