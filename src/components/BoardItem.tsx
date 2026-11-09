"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ListBullets,
  ListNumbers,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
} from "@phosphor-icons/react";
import type { ItemState } from "@/lib/merge";
import { cropImageStyle, LINK_FOOTER_HEIGHT, type CropEdge } from "@/lib/crop";
import { sanitizeNoteHtmlClient } from "@/lib/note-dom";
import { NOTE_PALETTE } from "@/lib/note-format";

function LabelInput({
  inputRef,
  draftLabel,
  onChange,
  onCommit,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draftLabel: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      ref={inputRef}
      className="label-input"
      value={draftLabel}
      placeholder="Label"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={onCommit}
      maxLength={120}
    />
  );
}

const NOTE_COMMANDS = [
  { cmd: "bold", Icon: TextB, title: "Bold (Ctrl+B)" },
  { cmd: "italic", Icon: TextItalic, title: "Italic (Ctrl+I)" },
  { cmd: "underline", Icon: TextUnderline, title: "Underline (Ctrl+U)" },
  { cmd: "strikeThrough", Icon: TextStrikethrough, title: "Strikethrough" },
  { cmd: "insertOrderedList", Icon: ListNumbers, title: "Numbered list" },
  { cmd: "insertUnorderedList", Icon: ListBullets, title: "Bullet list" },
] as const;

type NoteCommand = (typeof NOTE_COMMANDS)[number]["cmd"];

const NO_ACTIVE_COMMANDS: Record<NoteCommand, boolean> = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  insertOrderedList: false,
  insertUnorderedList: false,
};

/**
 * In-place note editor: a zoom-independent floating toolbar (formatting
 * commands + color picker) above an uncontrolled contentEditable. The draft
 * lives in the DOM so typing never resets the caret; the board keeps a
 * mirrored draft in state via onInput for click-away commits.
 */
function NoteEditor({
  item,
  scale,
  onChange,
  onCommit,
  onCancel,
  onColorChange,
}: {
  item: ItemState;
  /** Viewport zoom, used to keep the toolbar at a constant screen size. */
  scale: number;
  onChange: (item: ItemState, html: string) => void;
  onCommit: (item: ItemState, html: string) => void;
  onCancel: (item: ItemState) => void;
  onColorChange: (item: ItemState, color: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const customColorRef = useRef<HTMLInputElement | null>(null);
  const [active, setActive] = useState<Record<NoteCommand, boolean>>(NO_ACTIVE_COMMANDS);

  // Load the item's HTML once on mount; the draft is uncontrolled afterwards.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    document.execCommand("styleWithCSS", false, "false");
    el.innerHTML = item.content;
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the text selection in the toolbar's active states.
  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
      const next = { ...NO_ACTIVE_COMMANDS };
      for (const { cmd } of NOTE_COMMANDS) {
        try {
          next[cmd] = document.queryCommandState(cmd);
        } catch {
          next[cmd] = false;
        }
      }
      setActive(next);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  return (
    <>
      <div
        className="note-toolbar"
        style={{
          // Cancel the world zoom so the toolbar keeps a fixed screen size
          // (same treatment as group labels).
          transform: `scale(${1 / scale}) translateY(-8px)`,
          transformOrigin: "left bottom",
        }}
      >
        <div className="note-tool-row" role="toolbar" aria-label="Note formatting">
          {NOTE_COMMANDS.map(({ cmd, Icon, title }) => (
            <button
              key={cmd}
              type="button"
              className={`note-tool${active[cmd] ? " active" : ""}`}
              title={title}
              aria-label={title}
              aria-pressed={active[cmd]}
              // Keep the text selection: pointerdown's default action would
              // collapse it before the command runs.
              onPointerDown={(e) => {
                e.preventDefault();
                document.execCommand(cmd, false);
              }}
            >
              <Icon size={14} weight="bold" />
            </button>
          ))}
        </div>
        <div className="note-tool-row" role="group" aria-label="Note color">
          {NOTE_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`note-swatch${item.color === color ? " active" : ""}`}
              style={{ background: color }}
              title={color}
              aria-label={`Note color ${color}`}
              aria-pressed={item.color === color}
              onPointerDown={(e) => {
                e.preventDefault();
                onColorChange(item, color);
              }}
            />
          ))}
          <label
            className="note-custom-color"
            title="Custom color"
            onPointerDown={(e) => {
              // Don't steal focus from the editor (would commit the draft).
              e.preventDefault();
            }}
            onClick={() => {
              // pointerdown's preventDefault can suppress the native picker's
              // default activation; open it explicitly instead.
              try {
                customColorRef.current?.showPicker();
              } catch {
                /* unsupported browser — the input still works on plain click */
              }
            }}
          >
            <input
              ref={customColorRef}
              type="color"
              value={item.color}
              aria-label="Custom note color"
              onChange={(e) => onColorChange(item, e.target.value)}
            />
          </label>
        </div>
      </div>
      <div
        ref={editorRef}
        className="note-content"
        style={{ background: item.color }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Note text"
        onInput={(e) => onChange(item, e.currentTarget.innerHTML)}
        onPaste={(e) => {
          // Paste through the whitelist so the live DOM matches what is saved.
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          if (html) document.execCommand("insertHTML", false, sanitizeNoteHtmlClient(html));
          else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (editorRef.current) editorRef.current.innerHTML = item.content;
            onCancel(item);
          }
        }}
        onBlur={(e) => {
          // Moving focus to the custom color input keeps the edit open.
          if (e.relatedTarget === customColorRef.current) return;
          if (editorRef.current) onCommit(item, editorRef.current.innerHTML);
        }}
      />
    </>
  );
}

export function BoardItem({
  item,
  scale,
  selected,
  cropping,
  editing,
  draftLabel,
  onItemPointerDown,
  onResizePointerDown,
  onCropToggle,
  onCropPointerDown,
  onLabelDoubleClick,
  onLabelChange,
  onLabelCommit,
  onLabelCancel,
  onNoteChange,
  onNoteCommit,
  onNoteCancel,
  onNoteColorChange,
}: {
  item: ItemState;
  /** Viewport zoom, used to keep the note toolbar at a constant screen size. */
  scale: number;
  selected: boolean;
  cropping: boolean;
  editing: boolean;
  draftLabel: string;
  onItemPointerDown: (e: ReactPointerEvent, item: ItemState) => void;
  onResizePointerDown: (e: ReactPointerEvent, item: ItemState) => void;
  onCropToggle: (item: ItemState) => void;
  onCropPointerDown: (e: ReactPointerEvent, item: ItemState, edge: CropEdge) => void;
  onLabelDoubleClick: (item: ItemState) => void;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onLabelCancel: () => void;
  onNoteChange: (item: ItemState, html: string) => void;
  onNoteCommit: (item: ItemState, html: string) => void;
  onNoteCancel: (item: ItemState) => void;
  onNoteColorChange: (item: ItemState, color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Double-click anywhere on the item opens the label editor (inputs/links excepted).
  const startLabelEdit = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.closest("a")) return;
    // While a note is being edited, double-clicks select words — they must
    // not restart the edit (that would reset the mirrored draft).
    if (editing && item.kind === "note") return;
    onLabelDoubleClick(item);
  };

  const beginPointer = (e: ReactPointerEvent) => {
    const target = e.target as HTMLElement;
    // Never start a drag from the label input.
    if (target.tagName === "INPUT") return;
    // While a note is being edited, its whole surface belongs to the editor.
    if (editing && item.kind === "note") return;
    onItemPointerDown(e, item);
  };

  return (
    <div
      className={`board-item kind-${item.kind}${selected ? " selected" : ""}${item.label ? " has-label" : ""}`}
      style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
      onPointerDown={beginPointer}
      onDoubleClick={startLabelEdit}
    >
      {item.kind === "note" ? (
        editing ? (
          <NoteEditor
            item={item}
            scale={scale}
            onChange={onNoteChange}
            onCommit={onNoteCommit}
            onCancel={onNoteCancel}
            onColorChange={onNoteColorChange}
          />
        ) : (
          <div className="note-body" style={{ background: item.color }}>
            {item.content ? (
              <div
                className="note-content"
                dangerouslySetInnerHTML={{ __html: item.content }}
              />
            ) : (
              <span className="note-hint">Double-click to edit</span>
            )}
          </div>
        )
      ) : item.kind === "link" ? (
        <div className="link-card">
          <div className="link-thumb-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="link-thumb"
              src={`/api/storage/${item.objectKey}`}
              alt={item.title ?? item.siteName ?? item.originalName}
              draggable={false}
              style={cropImageStyle(item.crop)}
            />
          </div>
          <div className="link-footer">
            {editing ? (
              <LabelInput
                inputRef={inputRef}
                draftLabel={draftLabel}
                onChange={onLabelChange}
                onCommit={onLabelCommit}
                onCancel={onLabelCancel}
              />
            ) : (
              <>
                <span className="link-title">
                  {item.label || item.title || item.siteName || "Untitled"}
                </span>
                <span className="link-meta">
                  {item.siteName && <span className="link-site">{item.siteName}</span>}
                  {item.sourceUrl && (
                    <a
                      className="link-open"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={item.sourceUrl}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open ↗
                    </a>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="item-image-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/storage/${item.objectKey}`}
              alt={item.originalName}
              draggable={false}
              style={cropImageStyle(item.crop)}
            />
          </div>
          {/* Caption strip below the image; visibility is CSS-driven
              (labeled / hovered / selected). */}
          <div className="item-caption" onPointerDown={beginPointer}>
            {editing ? (
              <LabelInput
                inputRef={inputRef}
                draftLabel={draftLabel}
                onChange={onLabelChange}
                onCommit={onLabelCommit}
                onCancel={onLabelCancel}
              />
            ) : (
              <span className="item-caption-text" title="Double-click to label">
                {item.label || "Add label…"}
              </span>
            )}
          </div>
        </>
      )}

      {cropping && item.kind !== "note" && (
        <div
          className="crop-overlay"
          style={item.kind === "link" ? { bottom: LINK_FOOTER_HEIGHT } : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {(["top", "right", "bottom", "left"] as const).map((edge) => (
            <div
              key={edge}
              className={`crop-handle crop-handle-${edge}`}
              title={`Drag to crop the ${edge} edge`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onCropPointerDown(e, item, edge);
              }}
            />
          ))}
        </div>
      )}

      {selected && (
        <div
          className="resize-handle"
          title="Drag to resize · double-click to crop"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizePointerDown(e, item);
          }}
          onDoubleClick={(e) => {
            // Otherwise the item's own double-click would open the label editor.
            e.stopPropagation();
            onCropToggle(item);
          }}
        />
      )}
    </div>
  );
}
