/**
 * Extracts board-addable content from a clipboard payload: image files first,
 * then a pasted URL — mirroring the drag-and-drop precedence in Board
 * (files before links). Client-safe: no server-side imports.
 */

export type PastePayload = {
  files: File[];
  url: string | null;
};

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export interface ClipboardDataLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
  getData(type: string): string;
}

export function extractPastePayload(data: ClipboardDataLike | null): PastePayload {
  if (!data) return { files: [], url: null };

  const files: File[] = [];
  if (data.items) {
    for (let i = 0; i < data.items.length; i += 1) {
      const entry = data.items[i];
      if (entry.kind !== "file" || !entry.type.startsWith("image/")) continue;
      const file = entry.getAsFile();
      if (!file) continue;
      files.push(namedClipboardFile(file, files.length));
    }
  }
  if (files.length > 0) return { files, url: null };

  // Copied links: uri-list first, plain text fallback — same as the drop handler.
  const fromList = data.getData("text/uri-list").split(/\s+/)[0] ?? "";
  const candidate = (fromList || data.getData("text/plain")).trim();
  return { files, url: /^https?:\/\//i.test(candidate) ? candidate : null };
}

/** Clipboard images may arrive unnamed (e.g. screenshots); derive a usable name. */
function namedClipboardFile(file: File, index: number): File {
  if (file.name) return file;
  const ext = MIME_EXT[file.type.toLowerCase()] ?? "png";
  return new File([file], `pasted-image-${index + 1}.${ext}`, { type: file.type });
}
