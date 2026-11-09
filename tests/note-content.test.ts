import { describe, it, expect } from "vitest";
import {
  NOTE_MAX_CONTENT_LENGTH,
  cleanNoteColor,
  clampNoteCoord,
  clampNoteDim,
} from "@/lib/note-format";
import { sanitizeNoteContent } from "@/lib/note-content";

describe("sanitizeNoteContent", () => {
  it("keeps the toolbar's formatting tags", () => {
    const html =
      "<b>bold</b><strong>s</strong><i>i</i><em>e</em><u>u</u><s>s</s><strike>k</strike><del>d</del>";
    expect(sanitizeNoteContent(html)).toBe(html);
  });

  it("keeps lists intact", () => {
    const html = "<ol><li>one</li></ol><ul><li>two</li></ul>";
    expect(sanitizeNoteContent(html)).toBe(html);
  });

  it("strips script tags with their content", () => {
    expect(sanitizeNoteContent("hi<script>alert(1)</script>")).toBe("hi");
  });

  it("strips style tags with their content", () => {
    expect(sanitizeNoteContent("a<style>p{color:red}</style>b")).toBe("ab");
  });

  it("strips event handlers and attributes", () => {
    expect(sanitizeNoteContent('<b onclick="alert(1)" style="x">bold</b>')).toBe("<b>bold</b>");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeNoteContent("<span><b>bold</b> text</span>")).toBe("<b>bold</b> text");
  });

  it("returns empty for non-string input", () => {
    expect(sanitizeNoteContent(42)).toBe("");
    expect(sanitizeNoteContent(null)).toBe("");
    expect(sanitizeNoteContent(undefined)).toBe("");
  });

  it("caps the stored length", () => {
    const out = sanitizeNoteContent("x".repeat(NOTE_MAX_CONTENT_LENGTH + 500));
    expect(out).toHaveLength(NOTE_MAX_CONTENT_LENGTH);
  });
});

describe("cleanNoteColor", () => {
  it("accepts strict #rrggbb and normalizes to lowercase", () => {
    expect(cleanNoteColor("#F6D660")).toBe("#f6d660");
    expect(cleanNoteColor("#aecbfa")).toBe("#aecbfa");
  });

  it("rejects shorthand, names, and non-strings", () => {
    expect(cleanNoteColor("#fff")).toBeUndefined();
    expect(cleanNoteColor("f6d660")).toBeUndefined();
    expect(cleanNoteColor("red")).toBeUndefined();
    expect(cleanNoteColor(42)).toBeUndefined();
    expect(cleanNoteColor(undefined)).toBeUndefined();
  });
});

describe("clampNoteDim / clampNoteCoord", () => {
  it("clamps dims to the note bounds and rounds", () => {
    expect(clampNoteDim(100.7, 240)).toBe(101);
    expect(clampNoteDim(1, 240)).toBe(16);
    expect(clampNoteDim(99_999, 240)).toBe(8000);
    expect(clampNoteDim("nope", 240)).toBe(240);
  });

  it("falls back for non-finite coords", () => {
    expect(clampNoteCoord(12.5, 0)).toBe(12.5);
    expect(clampNoteCoord(Number.NaN, 7)).toBe(7);
    expect(clampNoteCoord(undefined, 7)).toBe(7);
  });
});
