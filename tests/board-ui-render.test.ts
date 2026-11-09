import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BoardItem } from "@/components/BoardItem";
import { GroupBox } from "@/components/GroupBox";
import type { GroupState, ItemState } from "@/lib/merge";

function item(overrides: Partial<ItemState> = {}): ItemState {
  return {
    id: "i1",
    kind: "image",
    x: 10,
    y: 20,
    width: 400,
    height: 300,
    rotation: 0,
    z: 1,
    crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 },
    objectKey: "p/1.png",
    originalName: "photo.png",
    mime: "image/png",
    sourceUrl: null,
    title: null,
    siteName: null,
    label: "",
    content: "",
    color: "#f6d660",
    addedBy: "u",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const noop = () => {};

function renderItem(props: Partial<Parameters<typeof BoardItem>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(BoardItem, {
      item: item(),
      scale: 1,
      selected: true,
      cropping: true,
      editing: false,
      draftLabel: "",
      onItemPointerDown: noop,
      onResizePointerDown: noop,
      onCropToggle: noop,
      onCropPointerDown: noop,
      onLabelDoubleClick: noop,
      onLabelChange: noop,
      onLabelCommit: noop,
      onLabelCancel: noop,
      onNoteChange: noop,
      onNoteCommit: noop,
      onNoteCancel: noop,
      onNoteColorChange: noop,
      ...props,
    })
  );
}

describe("BoardItem crop UI", () => {
  it("offsets and scales the image by the stored crop", () => {
    const html = renderItem();
    expect(html).toContain('class="item-image-frame"');
    expect(html).toContain("width:200%");
    expect(html).toContain("height:125%");
    expect(html).toContain("left:-50%");
    expect(html).toContain("top:-12.5%");
  });

  it("shows four edge handles while cropping", () => {
    const html = renderItem();
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(html).toContain(`crop-handle crop-handle-${edge}`);
    }
  });

  it("also crops link-card thumbnails, stopping at the footer", () => {
    const html = renderItem({ item: item({ kind: "link" }) });
    expect(html).toContain('class="link-thumb-frame"');
    expect(html).toContain("width:200%");
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(html).toContain(`crop-handle crop-handle-${edge}`);
    }
    // The bottom handle sits on the footer boundary, not the card's bottom.
    expect(html).toContain("bottom:52px");
  });

  it("hides crop handles when not in crop mode", () => {
    const html = renderItem({ cropping: false });
    expect(html).not.toContain("crop-handle");
  });

  it("keeps the resize handle available while cropping", () => {
    // Double-clicking it toggles crop mode, so it must not disappear.
    expect(renderItem({ cropping: false })).toContain('class="resize-handle"');
    expect(renderItem({ cropping: true })).toContain('class="resize-handle"');
    expect(renderItem({ cropping: true })).toContain('title="Drag to resize · double-click to crop"');
  });
});

function group(overrides: Partial<GroupState> = {}): GroupState {
  return {
    id: "g1",
    label: "Mood",
    x: 0,
    y: 0,
    width: 360,
    height: 240,
    z: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderGroup(scale: number) {
  return renderToStaticMarkup(
    createElement(GroupBox, {
      group: group(),
      scale,
      selected: false,
      bucketTarget: false,
      editing: false,
      draftLabel: "",
      onGroupPointerDown: noop,
      onResizePointerDown: noop,
      onResizeDoubleClick: noop,
      onLinkPointerDown: noop,
      onLabelDoubleClick: noop,
      onLabelChange: noop,
      onLabelCommit: noop,
      onLabelCancel: noop,
    })
  );
}

describe("GroupBox label zoom lock", () => {
  it("applies the inverse of the viewport zoom to the label", () => {
    expect(renderGroup(2)).toContain("transform:scale(0.5) translateY(-8px)");
    expect(renderGroup(0.5)).toContain("transform:scale(2) translateY(-8px)");
    expect(renderGroup(1)).toContain("transform:scale(1) translateY(-8px)");
  });

  it("keeps the label's on-screen width tied to the group width", () => {
    // At 0.5x zoom the label's world max-width doubles so it still spans the
    // group when the inverse transform is applied.
    expect(renderGroup(0.5)).toContain("max-width:180px");
    expect(renderGroup(2)).toContain("max-width:720px");
  });
});

function note(overrides: Partial<ItemState> = {}): ItemState {
  return item({ kind: "note", content: "", color: "#f6d660", ...overrides });
}

describe("BoardItem note UI", () => {
  it("renders the colored card with the stored content", () => {
    const html = renderItem({
      item: note({ content: "<b>bold</b><ol><li>one</li></ol>", color: "#aecbfa" }),
      cropping: false,
    });
    expect(html).toContain('class="note-body"');
    expect(html).toContain("background:#aecbfa");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<ol><li>one</li></ol>");
    // No crop handles for notes.
    expect(html).not.toContain("crop-handle");
  });

  it("shows an edit hint on an empty note", () => {
    expect(renderItem({ item: note() })).toContain("Double-click to edit");
  });

  it("renders the formatting toolbar with a zoom-locked transform while editing", () => {
    const html = renderItem({ item: note({ content: "<b>x</b>" }), editing: true });
    for (const label of [
      "Bold (Ctrl+B)",
      "Italic (Ctrl+I)",
      "Underline (Ctrl+U)",
      "Strikethrough",
      "Numbered list",
      "Bullet list",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    // Toolbar keeps a fixed screen size at 2x zoom.
    expect(renderItem({ item: note(), editing: true, scale: 2 })).toContain(
      "transform:scale(0.5) translateY(-8px)"
    );
    // The editable surface carries the note color and is empty (client fills it).
    expect(html).toContain("contentEditable");
    expect(html).toContain("background:#f6d660");
  });

  it("renders the color picker: palette swatches plus a custom input", () => {
    const html = renderItem({ item: note({ color: "#ef8a80" }), editing: true });
    for (const color of ["#f6d660", "#f2a45c", "#ef8a80", "#f2a7c3", "#b6dfb0", "#9fd8cb", "#aecbfa", "#cda9f2"]) {
      expect(html).toContain(`aria-label="Note color ${color}"`);
    }
    expect(html).toContain('type="color"');
    expect(html).toContain('aria-label="Custom note color"');
    // The active color is marked.
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps the resize handle available for notes", () => {
    expect(renderItem({ item: note(), cropping: false })).toContain('class="resize-handle"');
  });
});
