"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GroupState } from "@/lib/merge";

export function GroupBox({
  group,
  scale,
  selected,
  bucketTarget,
  editing,
  draftLabel,
  onGroupPointerDown,
  onResizePointerDown,
  onResizeDoubleClick,
  onLinkPointerDown,
  onLabelDoubleClick,
  onLabelChange,
  onLabelCommit,
  onLabelCancel,
}: {
  group: GroupState;
  /** Viewport zoom, used to keep the label at a constant screen size. */
  scale: number;
  selected: boolean;
  bucketTarget: boolean;
  editing: boolean;
  draftLabel: string;
  onGroupPointerDown: (e: ReactPointerEvent, group: GroupState) => void;
  onResizePointerDown: (e: ReactPointerEvent, group: GroupState) => void;
  onResizeDoubleClick: (group: GroupState) => void;
  onLinkPointerDown: (e: ReactPointerEvent, group: GroupState) => void;
  onLabelDoubleClick: (group: GroupState) => void;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onLabelCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div
      className={`group-box${selected ? " selected" : ""}${bucketTarget ? " bucket-target" : ""}`}
      style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
      onPointerDown={(e) => {
        // Never start a drag from the label input.
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        onGroupPointerDown(e, group);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        onLabelDoubleClick(group);
      }}
    >
      <div
        className="group-label"
        style={{
          // Cancel the world zoom so the label keeps a fixed screen size, and
          // keep a constant 8px gap above the box (translate is scaled by the
          // inverse transform, so it stays 8px on screen at every zoom).
          transform: `scale(${1 / scale}) translateY(-8px)`,
          transformOrigin: "left bottom",
          maxWidth: group.width * scale,
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="group-label-input"
            value={draftLabel}
            placeholder="Group label"
            onChange={(e) => onLabelChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onLabelCommit();
              if (e.key === "Escape") onLabelCancel();
            }}
            onBlur={onLabelCommit}
            maxLength={120}
          />
        ) : (
          <span className="group-label-text" title="Double-click to rename">
            {group.label || "Unnamed group"}
          </span>
        )}
      </div>
      {selected && (
        <>
          <div
            className="group-resize-handle"
            title="Drag to resize · double-click to fit to contents"
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizePointerDown(e, group);
            }}
            onDoubleClick={(e) => {
              // Otherwise the box's own double-click would rename the label.
              e.stopPropagation();
              onResizeDoubleClick(group);
            }}
          />
          <div
            className="link-handle"
            title="Drag onto another group to connect"
            onPointerDown={(e) => {
              e.stopPropagation();
              onLinkPointerDown(e, group);
            }}
          />
        </>
      )}
    </div>
  );
}
