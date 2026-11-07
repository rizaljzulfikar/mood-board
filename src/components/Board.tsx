"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { mergeRemoteItems, type ItemState } from "@/lib/merge";
import { fitViewport, toScreen, toWorld, zoomAt, type Viewport } from "@/lib/viewport";
import { BoardItem } from "./BoardItem";
import { Toolbar, type ProjectInfo } from "./Toolbar";

type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
};

const SYNC_INTERVAL_MS = 2000;
const ZOOM_STEP = 1.1;
const MIN_DIM = 24;
const MAX_DIM = 8000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type DragState =
  | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; startX: number; startY: number; aspect: number }
  | null;

export function Board({
  projectId,
  initialItems,
  user,
  project,
}: {
  projectId: string;
  initialItems: ItemState[];
  user: { id: string; name: string };
  project: ProjectInfo;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<ItemState[]>(initialItems);
  const itemsRef = useRef(initialItems);
  const setBoth = useCallback((next: ItemState[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const dragRef = useRef<DragState>(null);
  const lockedRef = useRef<Set<string>>(new Set());
  const sinceRef = useRef<string | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  const updateViewport = useCallback((v: Viewport) => {
    viewportRef.current = v;
    setViewport(v);
  }, []);

  /* ---------- upload ---------- */

  const uploadFiles = useCallback(
    async (files: File[], worldX: number, worldY: number) => {
      const images = files.filter(
        (f) => f.type.startsWith("image/") && f.size <= MAX_UPLOAD_BYTES
      );
      if (images.length === 0) return;
      setUploading(true);
      try {
        for (const [i, file] of images.entries()) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("x", String(Math.round(worldX + i * 24)));
          fd.append("y", String(Math.round(worldY + i * 24)));
          const res = await fetch(`/api/projects/${projectId}/items`, {
            method: "POST",
            body: fd,
          });
          if (res.ok) {
            const data = (await res.json()) as { item: ItemState };
            setBoth([...itemsRef.current, data.item]);
            setSelectedId(data.item.id);
          }
        }
      } finally {
        setUploading(false);
      }
    },
    [projectId, setBoth]
  );

  const centerWorld = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return toWorld(rect.width / 2, rect.height / 2, viewportRef.current);
  }, []);

  /* ---------- persistence ---------- */

  const patchItem = useCallback(
    async (id: string, patch: Partial<Pick<ItemState, "x" | "y" | "width" | "height" | "z">>) => {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 404) {
        // Deleted by a teammate while we were dragging it.
        setBoth(itemsRef.current.filter((i) => i.id !== id));
      }
    },
    [setBoth]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      setBoth(itemsRef.current.filter((i) => i.id !== id));
      if (selectedRef.current === id) setSelectedId(null);
      await fetch(`/api/items/${id}`, { method: "DELETE" });
    },
    [setBoth]
  );

  /* ---------- pointer interactions ---------- */

  const screenToBoard = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const startMove = useCallback(
    (e: ReactPointerEvent, item: ItemState) => {
      if (e.button === 1) return; // middle button pans
      e.stopPropagation();
      containerRef.current?.setPointerCapture(e.pointerId);

      setSelectedId(item.id);
      selectedRef.current = item.id;

      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);
      const maxZ = itemsRef.current.reduce((m, i) => Math.max(m, i.z), 0);
      const nextZ = item.z === maxZ ? item.z : maxZ + 1;
      if (nextZ !== item.z) {
        setBoth(itemsRef.current.map((i) => (i.id === item.id ? { ...i, z: nextZ } : i)));
      }

      lockedRef.current.add(item.id);
      dragRef.current = {
        kind: "move",
        id: item.id,
        dx: world.x - item.x,
        dy: world.y - item.y,
      };
    },
    [screenToBoard, setBoth]
  );

  const startResize = useCallback(
    (e: ReactPointerEvent, item: ItemState) => {
      containerRef.current?.setPointerCapture(e.pointerId);
      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);
      lockedRef.current.add(item.id);
      dragRef.current = {
        kind: "resize",
        id: item.id,
        startX: world.x,
        startY: world.y,
        aspect: item.height / item.width,
      };
    },
    [screenToBoard]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      const onBackground = el === containerRef.current || el.dataset.background === "true";
      if (e.button === 1 || (e.button === 0 && onBackground)) {
        e.preventDefault();
        if (e.button === 0) {
          setSelectedId(null);
          selectedRef.current = null;
        }
        containerRef.current?.setPointerCapture(e.pointerId);
        dragRef.current = {
          kind: "pan",
          startX: e.clientX,
          startY: e.clientY,
          vx: viewportRef.current.x,
          vy: viewportRef.current.y,
        };
      }
    },
    []
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const board = screenToBoard(e.clientX, e.clientY);
      const drag = dragRef.current;

      if (!drag) {
        const world = toWorld(board.x, board.y, viewportRef.current);
        cursorRef.current = world;
        return;
      }

      if (drag.kind === "pan") {
        updateViewport({
          ...viewportRef.current,
          x: drag.vx + (e.clientX - drag.startX),
          y: drag.vy + (e.clientY - drag.startY),
        });
        return;
      }

      const world = toWorld(board.x, board.y, viewportRef.current);

      if (drag.kind === "move") {
        setBoth(
          itemsRef.current.map((i) =>
            i.id === drag.id ? { ...i, x: world.x - drag.dx, y: world.y - drag.dy } : i
          )
        );
      } else if (drag.kind === "resize") {
        const item = itemsRef.current.find((i) => i.id === drag.id);
        if (!item) return;
        const width = Math.min(MAX_DIM, Math.max(MIN_DIM, world.x - item.x));
        const height = Math.min(MAX_DIM, Math.max(MIN_DIM, width * drag.aspect));
        setBoth(
          itemsRef.current.map((i) =>
            i.id === drag.id ? { ...i, width, height } : i
          )
        );
      }
    },
    [screenToBoard, setBoth, updateViewport]
  );

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.kind === "move") {
      const item = itemsRef.current.find((i) => i.id === drag.id);
      if (item) {
        lockedRef.current.delete(drag.id);
        void patchItem(drag.id, { x: item.x, y: item.y, z: item.z });
      }
    } else if (drag.kind === "resize") {
      const item = itemsRef.current.find((i) => i.id === drag.id);
      if (item) {
        lockedRef.current.delete(drag.id);
        void patchItem(drag.id, { width: item.width, height: item.height });
      }
    }
  }, [patchItem]);

  /* ---------- wheel zoom (non-passive so we can preventDefault) ---------- */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      updateViewport(
        zoomAt(viewportRef.current, e.clientX - rect.left, e.clientY - rect.top, factor)
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [updateViewport]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        setSelectedId(null);
        selectedRef.current = null;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        void deleteItem(selectedRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteItem]);

  /* ---------- collaboration sync ---------- */

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ since: sinceRef.current, cursor: cursorRef.current }),
        });
        if (!res.ok || stopped) return;
        const data = (await res.json()) as {
          items: ItemState[];
          deletedIds: string[];
          users: PresenceUser[];
          now: string;
        };
        sinceRef.current = data.now;
        setUsers(data.users);
        setBoth(
          mergeRemoteItems(itemsRef.current, data.items, data.deletedIds, [
            ...lockedRef.current,
          ])
        );
      } catch {
        /* transient network error — next tick retries */
      }
    };
    void tick();
    const interval = setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [projectId, setBoth]);

  /* ---------- render ---------- */

  const zoomIn = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    updateViewport(zoomAt(viewportRef.current, rect.width / 2, rect.height / 2, ZOOM_STEP));
  };
  const zoomOut = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    updateViewport(zoomAt(viewportRef.current, rect.width / 2, rect.height / 2, 1 / ZOOM_STEP));
  };
  const fit = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) updateViewport(fitViewport(itemsRef.current, rect.width, rect.height));
  };

  const v = viewport;
  const sorted = [...items].sort((a, b) => a.z - b.z);

  return (
    <div
      className="board"
      ref={containerRef}
      data-background="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropActive(false);
        const board = screenToBoard(e.clientX, e.clientY);
        const world = toWorld(board.x, board.y, viewportRef.current);
        void uploadFiles(Array.from(e.dataTransfer.files), world.x, world.y);
      }}
    >
      <div
        className="world"
        data-background="true"
        style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})` }}
      >
        {sorted.map((item) => (
          <BoardItem
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onItemPointerDown={startMove}
            onResizePointerDown={startResize}
          />
        ))}
      </div>

      {users.map((u) =>
        u.cursor ? (
          <div
            key={u.userId}
            className="presence-cursor"
            style={
              {
                left: toScreen(u.cursor.x, u.cursor.y, v).x,
                top: toScreen(u.cursor.x, u.cursor.y, v).y,
                "--pc": u.color,
              } as React.CSSProperties
            }
          >
            <span>{u.name}</span>
          </div>
        ) : null
      )}

      {items.length === 0 && !uploading && (
        <div className="empty-hint">
          Drag & drop images anywhere on this canvas — or hit “Upload images”.
        </div>
      )}
      {dropActive && <div className="drop-overlay">Drop to add images</div>}
      {uploading && <div className="upload-toast">Uploading…</div>}

      <div className="board-toolbar">
        <Toolbar
          project={project}
          zoomPercent={v.scale * 100}
          activeUsers={users}
          uploading={uploading}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fit}
          onUploadClick={() => fileInputRef.current?.click()}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          const center = centerWorld();
          void uploadFiles(files, center.x, center.y);
          e.target.value = "";
        }}
      />
    </div>
  );
}
