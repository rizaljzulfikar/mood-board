"use client";

import { edgeAnchors } from "@/lib/geometry";
import type { ConnectionState, GroupState } from "@/lib/merge";

export type ConnectionPreview = { from: { x: number; y: number }; to: { x: number; y: number } };

/** Padding so the stroke and arrowhead never clip at the SVG bounds. */
const PAD = 12;

function Segment({
  startX,
  startY,
  endX,
  endY,
  dashed,
  arrow,
  className,
  markerId,
  onPointerDown,
  onClick,
  onDoubleClick,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  dashed?: boolean;
  arrow: boolean;
  className: string;
  markerId?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const minX = Math.min(startX, endX) - PAD;
  const minY = Math.min(startY, endY) - PAD;
  const width = Math.max(1, Math.abs(endX - startX) + PAD * 2);
  const height = Math.max(1, Math.abs(endY - startY) + PAD * 2);
  return (
    <svg
      className="connection-svg"
      style={{ left: minX, top: minY, width, height }}
      viewBox={`0 0 ${width} ${height}`}
    >
      {markerId && arrow && (
        <defs>
          <marker
            id={markerId}
            markerUnits="userSpaceOnUse"
            markerWidth={16}
            markerHeight={12}
            refX={15}
            refY={6}
            orient="auto"
          >
            <path d="M0,0 L16,6 L0,12 Z" className="connection-arrowhead" />
          </marker>
        </defs>
      )}
      {onPointerDown && (
        <path
          className="connection-hit"
          d={`M ${startX - minX} ${startY - minY} L ${endX - minX} ${endY - minY}`}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        />
      )}
      <path
        className={className}
        d={`M ${startX - minX} ${startY - minY} L ${endX - minX} ${endY - minY}`}
        strokeDasharray={dashed ? "6 5" : undefined}
        markerEnd={markerId && arrow ? `url(#${markerId})` : undefined}
      />
    </svg>
  );
}

export function ConnectionLayer({
  connections,
  groupsById,
  selectedId,
  preview,
  onSelect,
  onStyleToggle,
}: {
  connections: ConnectionState[];
  groupsById: Map<string, GroupState>;
  selectedId: string | null;
  preview: ConnectionPreview | null;
  onSelect: (id: string) => void;
  onStyleToggle: (id: string) => void;
}) {
  return (
    <>
      {connections.map((c) => {
        const from = groupsById.get(c.from);
        const to = groupsById.get(c.to);
        if (!from || !to) return null;
        const { start, end } = edgeAnchors(from, to);
        const selected = c.id === selectedId;
        return (
          <Segment
            key={c.id}
            startX={start.x}
            startY={start.y}
            endX={end.x}
            endY={end.y}
            arrow={c.style === "arrow"}
            markerId={`arrow-${c.id}`}
            className={`connection-line style-${c.style}${selected ? " selected" : ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(c.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStyleToggle(c.id);
            }}
          />
        );
      })}
      {preview && (
        <Segment
          startX={preview.from.x}
          startY={preview.from.y}
          endX={preview.to.x}
          endY={preview.to.y}
          arrow
          dashed
          markerId="arrow-preview"
          className="connection-preview"
        />
      )}
    </>
  );
}
