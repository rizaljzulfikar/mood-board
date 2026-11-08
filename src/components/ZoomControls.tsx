import { ArrowUUpLeft, ArrowUUpRight, FrameCorners, Minus, Plus } from "@phosphor-icons/react";

const ICON = { size: 15, weight: "bold" as const };

export function ZoomControls({
  zoomPercent,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onUndo,
  onRedo,
}: {
  zoomPercent: number;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div
      className="zoom-controls zoom-group"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="icon-button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <ArrowUUpLeft {...ICON} />
      </button>
      <button
        className="icon-button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        <ArrowUUpRight {...ICON} />
      </button>
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
