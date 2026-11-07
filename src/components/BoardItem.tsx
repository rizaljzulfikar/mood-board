"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { ItemState } from "@/lib/merge";

export function BoardItem({
  item,
  selected,
  onItemPointerDown,
  onResizePointerDown,
}: {
  item: ItemState;
  selected: boolean;
  onItemPointerDown: (e: ReactPointerEvent, item: ItemState) => void;
  onResizePointerDown: (e: ReactPointerEvent, item: ItemState) => void;
}) {
  return (
    <div
      className={`board-item${selected ? " selected" : ""}`}
      style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
      onPointerDown={(e) => onItemPointerDown(e, item)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/storage/${item.objectKey}`}
        alt={item.originalName}
        draggable={false}
      />
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
