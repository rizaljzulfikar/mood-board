import sanitizeHtml from "sanitize-html";
import { NOTE_ALLOWED_TAGS, NOTE_MAX_CONTENT_LENGTH } from "./note-format";

/** Server-side sanitizer for note rich text (sanitize-html based). */
export function sanitizeNoteContent(html: unknown): string {
  if (typeof html !== "string") return "";
  const clean = sanitizeHtml(html, {
    allowedTags: [...NOTE_ALLOWED_TAGS],
    allowedAttributes: {},
    // A pasted <script> or <style> keeps nothing, not even its text.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
  });
  return clean.slice(0, NOTE_MAX_CONTENT_LENGTH);
}
