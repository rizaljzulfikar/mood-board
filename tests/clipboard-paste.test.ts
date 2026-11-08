import { describe, it, expect } from "vitest";
import { extractPastePayload, type ClipboardDataLike } from "@/lib/clipboard";

type ItemSpec = { kind: string; type: string; file?: File | null };

function clipboardData({ items = [], uriList = "", text = "" }: { items?: ItemSpec[]; uriList?: string; text?: string } = {}): ClipboardDataLike {
  return {
    items: items.map((spec) => ({
      kind: spec.kind,
      type: spec.type,
      getAsFile: () => spec.file ?? null,
    })),
    getData: (type: string) => (type === "text/uri-list" ? uriList : text),
  };
}

describe("extractPastePayload", () => {
  it("returns image files from clipboard items", () => {
    const png = new File(["bits"], "shot.png", { type: "image/png" });
    const payload = extractPastePayload(
      clipboardData({ items: [{ kind: "file", type: "image/png", file: png }] })
    );
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("shot.png");
    expect(payload.url).toBeNull();
  });

  it("keeps multiple images in order", () => {
    const png = new File(["a"], "a.png", { type: "image/png" });
    const jpeg = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const payload = extractPastePayload(
      clipboardData({
        items: [
          { kind: "file", type: "image/png", file: png },
          { kind: "file", type: "image/jpeg", file: jpeg },
        ],
      })
    );
    expect(payload.files.map((f) => f.name)).toEqual(["a.png", "b.jpg"]);
  });

  it("names unnamed clipboard images from their mime", () => {
    const blob = new File(["bits"], "", { type: "image/webp" });
    const payload = extractPastePayload(
      clipboardData({ items: [{ kind: "file", type: "image/webp", file: blob }] })
    );
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("pasted-image-1.webp");
  });

  it("skips non-image file entries", () => {
    const txt = new File(["hi"], "notes.txt", { type: "text/plain" });
    const payload = extractPastePayload(
      clipboardData({ items: [{ kind: "file", type: "text/plain", file: txt }] })
    );
    expect(payload.files).toHaveLength(0);
    expect(payload.url).toBeNull();
  });

  it("prefers files over a pasted URL, like drag-and-drop", () => {
    const png = new File(["bits"], "shot.png", { type: "image/png" });
    const payload = extractPastePayload(
      clipboardData({
        items: [{ kind: "file", type: "image/png", file: png }],
        uriList: "https://example.com/a",
        text: "https://example.com/a",
      })
    );
    expect(payload.files).toHaveLength(1);
    expect(payload.url).toBeNull();
  });

  it("reads a URL from text/uri-list", () => {
    const payload = extractPastePayload(
      clipboardData({ uriList: "https://example.com/page\r\nhttps://example.com/alt", text: "" })
    );
    expect(payload.url).toBe("https://example.com/page");
  });

  it("falls back to plain text for URLs", () => {
    const payload = extractPastePayload(
      clipboardData({ uriList: "", text: "  http://example.com/img.png  " })
    );
    expect(payload.url).toBe("http://example.com/img.png");
  });

  it("rejects non-URL text", () => {
    const payload = extractPastePayload(clipboardData({ text: "just some words" }));
    expect(payload.files).toHaveLength(0);
    expect(payload.url).toBeNull();
  });

  it("handles missing clipboard data", () => {
    expect(extractPastePayload(null)).toEqual({ files: [], url: null });
  });
});
