import { FrameCorners, Minus, Plus } from "@phosphor-icons/react";

const ICON = { size: 15, weight: "bold" as const };

export function ZoomControls({
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div
      className="zoom-controls zoom-group"
      role="toolbar"
      aria-label="Zoom"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="icon-button"
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <Minus {...ICON} />
      </button>
      <span className="zoom-pill">{Math.round(zoomPercent)}%</span>
      <button
        className="icon-button"
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <Plus {...ICON} />
      </button>
      <button
        className="icon-button"
        onClick={onFit}
        title="Zoom to fit"
        aria-label="Zoom to fit"
      >
        <FrameCorners {...ICON} />
      </button>
    </div>
  );
}
