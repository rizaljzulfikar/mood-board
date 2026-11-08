"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ItemState } from "@/lib/merge";

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

export function BoardItem({
  item,
  selected,
  editing,
  draftLabel,
  onItemPointerDown,
  onResizePointerDown,
  onLabelDoubleClick,
  onLabelChange,
  onLabelCommit,
  onLabelCancel,
}: {
  item: ItemState;
  selected: boolean;
  editing: boolean;
  draftLabel: string;
  onItemPointerDown: (e: ReactPointerEvent, item: ItemState) => void;
  onResizePointerDown: (e: ReactPointerEvent, item: ItemState) => void;
  onLabelDoubleClick: (item: ItemState) => void;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onLabelCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Double-click anywhere on the item opens the label editor (inputs/links excepted).
  const startLabelEdit = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.closest("a")) return;
    onLabelDoubleClick(item);
  };

  const beginPointer = (e: ReactPointerEvent) => {
    // Never start a drag from the label input.
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    onItemPointerDown(e, item);
  };

  return (
    <div
      className={`board-item kind-${item.kind}${selected ? " selected" : ""}${item.label ? " has-label" : ""}`}
      style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
      onPointerDown={beginPointer}
      onDoubleClick={startLabelEdit}
    >
      {item.kind === "link" ? (
        <div className="link-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="link-thumb"
            src={`/api/storage/${item.objectKey}`}
            alt={item.title ?? item.siteName ?? item.originalName}
            draggable={false}
          />
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/storage/${item.objectKey}`}
            alt={item.originalName}
            draggable={false}
          />
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

      {selected && (
        <div
          className="resize-handle"
          title="Resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizePointerDown(e, item);
          }}
        />
      )}
    </div>
  );
}
