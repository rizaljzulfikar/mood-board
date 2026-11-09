/**
 * Client-side note HTML sanitizer (browser DOMParser based). Used for pasted
 * markup inside the note editor so the live DOM stays within the same tag
 * whitelist the server enforces on save. Unknown tags are unwrapped (their
 * text survives); script/style subtrees are dropped entirely.
 */
import { NOTE_ALLOWED_TAGS } from "./note-format";

const DROP_SUBTREE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "textarea",
  "option",
]);

export function sanitizeNoteHtmlClient(html: string): string {
  if (!html) return "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set<string>(NOTE_ALLOWED_TAGS);

  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return node;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) return null;
    if (!allowed.has(tag)) {
      // Unwrap: keep the children, sanitized.
      const frag = document.createDocumentFragment();
      for (const child of [...el.childNodes]) {
        const clean = cleanNode(child);
        if (clean) frag.appendChild(clean);
      }
      return frag;
    }
    const replacement = document.createElement(tag);
    for (const child of [...el.childNodes]) {
      const clean = cleanNode(child);
      if (clean) replacement.appendChild(clean);
    }
    return replacement;
  };

  const result = document.createElement("div");
  for (const child of [...parsed.body.childNodes]) {
    const clean = cleanNode(child);
    if (clean) result.appendChild(clean);
  }
  return result.innerHTML;
}
