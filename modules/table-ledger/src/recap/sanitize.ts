// Recap HTML is GM/planner-authored, but strip active content before it lands
// in a player-visible journal. Browser-only (DOMParser).

const REMOVE = "script, iframe, object, embed, frame, frameset";
const URL_ATTRS: Record<string, true> = { href: true, src: true, "xlink:href": true, action: true, formaction: true };
// Active schemes, and every `data:` URL (data documents such as xhtml/svg can execute).
// Control chars/whitespace inside the scheme are ignored by browsers, so strip them first.
const UNSAFE_URL = /^(javascript|vbscript|data):/i;

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, "text/html");
  for (const el of doc.body.querySelectorAll(REMOVE)) el.remove();
  for (const el of doc.body.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      const lower = name.toLowerCase();
      if (
        lower.startsWith("on") ||
        lower === "srcdoc" ||
        (URL_ATTRS[lower] && UNSAFE_URL.test(value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "")))
      ) {
        el.removeAttribute(name);
      }
    }
  }
  return doc.body.innerHTML;
}
