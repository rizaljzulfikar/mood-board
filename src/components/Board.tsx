"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  mergeRemoteEntities,
  mergeRemoteItems,
  type ConnectionState,
  type GroupState,
  type ItemState,
} from "@/lib/merge";
import { edgeAnchors, expandRectToContain, pointInRect, rectContainsItemCenter, topGroupContaining } from "@/lib/geometry";
import { movedPastDragThreshold } from "@/lib/drag";
import { extractPastePayload } from "@/lib/clipboard";
import {
  commitHistory,
  initHistory,
  planServerOps,
  redoHistory,
  undoHistory,
  type HistoryStack,
  type ServerOp,
  type Snapshot,
} from "@/lib/history";
import { fitViewport, toScreen, toWorld, zoomAt, type Viewport } from "@/lib/viewport";
import { BoardItem } from "./BoardItem";
import { GroupBox } from "./GroupBox";
import { ConnectionLayer, type ConnectionPreview } from "./ConnectionLayer";
import { Toolbar, type ProjectInfo } from "./Toolbar";
import { ActionBar } from "./ActionBar";
import { ZoomControls } from "./ZoomControls";

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
const MIN_GROUP_DIM = 60;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const GROUP_BUCKET_PADDING = 32;
const NEW_GROUP_WIDTH = 360;
const NEW_GROUP_HEIGHT = 240;

type Selection = { kind: "item" | "group" | "connection"; id: string } | null;

type DragState =
  | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; startX: number; startY: number; aspect: number }
  | { kind: "group-move"; id: string; dx: number; dy: number; memberIds: string[] }
  | { kind: "group-resize"; id: string }
  | { kind: "connect"; fromId: string; x: number; y: number }
  | null;

/**
 * A press that has not moved yet. It becomes a real drag once the pointer
 * travels past the drag threshold; until then no pointer capture is taken, so
 * clicks and double-clicks reach the element under the pointer.
 */
type PendingDrag = {
  drag: NonNullable<DragState>;
  pointerId: number;
  startX: number;
  startY: number;
  /** Side effects that only matter once the drag actually starts. */
  activate: () => void;
};

export function Board({
  projectId,
  initialItems,
  initialGroups,
  initialConnections,
  user,
  project,
}: {
  projectId: string;
  initialItems: ItemState[];
  initialGroups: GroupState[];
  initialConnections: ConnectionState[];
  user: { id: string; name: string };
  project: ProjectInfo;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<ItemState[]>(initialItems);
  const itemsRef = useRef(initialItems);
  const setItemsBoth = useCallback((next: ItemState[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const [groups, setGroups] = useState<GroupState[]>(initialGroups);
  const groupsRef = useRef(initialGroups);
  const setGroupsBoth = useCallback((next: GroupState[]) => {
    groupsRef.current = next;
    setGroups(next);
  }, []);

  const [connections, setConnections] = useState<ConnectionState[]>(initialConnections);
  const connectionsRef = useRef(initialConnections);
  const setConnectionsBoth = useCallback((next: ConnectionState[]) => {
    connectionsRef.current = next;
    setConnections(next);
  }, []);

  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport);

  const [selection, setSelection] = useState<Selection>(null);
  const selectionRef = useRef<Selection>(null);
  const select = useCallback((next: Selection) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const [labelEdit, setLabelEdit] = useState<{
    id: string;
    draft: string;
    target: "group" | "item";
  } | null>(null);
  const [connectPoint, setConnectPoint] = useState<{ x: number; y: number } | null>(null);
  // Group currently "catching" a dragged image — highlighted as the bucket target.
  const [bucketTargetId, setBucketTargetId] = useState<string | null>(null);

  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importingLink, setImportingLink] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const dragRef = useRef<DragState>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const lockedRef = useRef<Set<string>>(new Set());
  const sinceRef = useRef<string | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  /* ---------- undo / redo history ---------- */

  const historyRef = useRef<HistoryStack>(
    initHistory({ items: initialItems, groups: initialGroups, connections: initialConnections })
  );
  // Bumped whenever the stacks change so button disabled-states re-render.
  const [, setHistTick] = useState(0);

  const snapshotBoard = useCallback(
    (): Snapshot => ({
      items: itemsRef.current,
      groups: groupsRef.current,
      connections: connectionsRef.current,
    }),
    []
  );

  /** Record the current board as the newest settled state (one entry per gesture). */
  const commitSettled = useCallback(() => {
    historyRef.current = commitHistory(historyRef.current, snapshotBoard());
    setHistTick((t) => t + 1);
  }, [snapshotBoard]);

  const applyServerOps = useCallback((ops: ServerOp[]) => {
    for (const op of ops) {
      void fetch(`/api/${op.kind}s/${op.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op.body),
      }).catch(() => {});
    }
  }, []);

  const runHistory = useCallback(
    (dir: "undo" | "redo") => {
      if (dragRef.current || pendingRef.current) return;
      const current = snapshotBoard();
      const result =
        dir === "undo" ? undoHistory(historyRef.current, current) : redoHistory(historyRef.current, current);
      if (!result) return;
      historyRef.current = result.stack;
      setItemsBoth(result.target.items);
      setGroupsBoth(result.target.groups);
      setConnectionsBoth(result.target.connections);
      applyServerOps(planServerOps(result.target, current));
      const sel = selectionRef.current;
      if (sel) {
        const pool =
          sel.kind === "item"
            ? result.target.items
            : sel.kind === "group"
              ? result.target.groups
              : result.target.connections;
        if (!pool.some((entity) => entity.id === sel.id)) select(null);
      }
      setHistTick((t) => t + 1);
    },
    [applyServerOps, select, setConnectionsBoth, setGroupsBoth, setItemsBoth, snapshotBoard]
  );

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
            setItemsBoth([...itemsRef.current, data.item]);
            select({ kind: "item", id: data.item.id });
          }
        }
        // The whole batch is one undo entry.
        commitSettled();
      } finally {
        setUploading(false);
      }
    },
    [commitSettled, projectId, select, setItemsBoth]
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
        setItemsBoth(itemsRef.current.filter((i) => i.id !== id));
      }
    },
    [setItemsBoth]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      setItemsBoth(itemsRef.current.filter((i) => i.id !== id));
      commitSettled();
      if (selectionRef.current?.kind === "item" && selectionRef.current.id === id) {
        select(null);
      }
      await fetch(`/api/items/${id}`, { method: "DELETE" });
    },
    [commitSettled, select, setItemsBoth]
  );

  const patchGroup = useCallback(
    async (
      id: string,
      patch: Partial<Pick<GroupState, "x" | "y" | "width" | "height" | "z" | "label">>
    ) => {
      const res = await fetch(`/api/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 404) {
        // Deleted by a teammate while we were dragging it.
        setGroupsBoth(groupsRef.current.filter((g) => g.id !== id));
        setConnectionsBoth(
          connectionsRef.current.filter((c) => c.from !== id && c.to !== id)
        );
      }
    },
    [setConnectionsBoth, setGroupsBoth]
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      // Images stay on the canvas; only the box and its connections go away.
      setGroupsBoth(groupsRef.current.filter((g) => g.id !== id));
      setConnectionsBoth(connectionsRef.current.filter((c) => c.from !== id && c.to !== id));
      commitSettled();
      if (selectionRef.current?.id === id) select(null);
      if (labelEdit?.id === id) setLabelEdit(null);
      await fetch(`/api/groups/${id}`, { method: "DELETE" });
    },
    [commitSettled, labelEdit?.id, select, setConnectionsBoth, setGroupsBoth]
  );

  const deleteConnection = useCallback(
    async (id: string) => {
      setConnectionsBoth(connectionsRef.current.filter((c) => c.id !== id));
      commitSettled();
      if (selectionRef.current?.kind === "connection" && selectionRef.current.id === id) {
        select(null);
      }
      await fetch(`/api/connections/${id}`, { method: "DELETE" });
    },
    [commitSettled, select, setConnectionsBoth]
  );

  const toggleConnectionStyle = useCallback(
    async (id: string) => {
      const connection = connectionsRef.current.find((c) => c.id === id);
      if (!connection) return;
      const style = connection.style === "arrow" ? "line" : "arrow";
      setConnectionsBoth(
        connectionsRef.current.map((c) => (c.id === id ? { ...c, style } : c))
      );
      commitSettled();
      await fetch(`/api/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style }),
      });
    },
    [commitSettled, setConnectionsBoth]
  );

  const createConnection = useCallback(
    async (fromId: string, toId: string) => {
      const res = await fetch(`/api/projects/${projectId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId, toId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { connection: ConnectionState };
      setConnectionsBoth([...connectionsRef.current, data.connection]);
      commitSettled();
    },
    [commitSettled, projectId, setConnectionsBoth]
  );

  const addGroup = useCallback(async () => {
    const center = centerWorld();
    const res = await fetch(`/api/projects/${projectId}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x: Math.round(center.x - NEW_GROUP_WIDTH / 2),
        y: Math.round(center.y - NEW_GROUP_HEIGHT / 2),
        width: NEW_GROUP_WIDTH,
        height: NEW_GROUP_HEIGHT,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { group: GroupState };
    setGroupsBoth([...groupsRef.current, data.group]);
    commitSettled();
    select({ kind: "group", id: data.group.id });
    setLabelEdit({ id: data.group.id, draft: "", target: "group" });
  }, [centerWorld, commitSettled, projectId, select, setGroupsBoth]);

  /* ---------- link import ---------- */

  const importFromUrl = useCallback(
    async (rawUrl: string, worldX: number, worldY: number): Promise<string | null> => {
      setImportingLink(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/items/from-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: rawUrl, x: Math.round(worldX), y: Math.round(worldY) }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "Could not import that link";
        }
        const data = (await res.json()) as { item: ItemState };
        setItemsBoth([...itemsRef.current, data.item]);
        commitSettled();
        select({ kind: "item", id: data.item.id });
        return null;
      } catch {
        return "Could not import that link";
      } finally {
        setImportingLink(false);
      }
    },
    [commitSettled, projectId, select, setItemsBoth]
  );

  /* ---------- label editing (groups and items) ---------- */

  const commitLabelEdit = useCallback(() => {
    if (!labelEdit) return;
    const { id, draft, target } = labelEdit;
    setLabelEdit(null);
    const label = draft.trim().slice(0, 120);

    if (target === "group") {
      const group = groupsRef.current.find((g) => g.id === id);
      if (!group) return;
      if (label === group.label) return;
      setGroupsBoth(groupsRef.current.map((g) => (g.id === id ? { ...g, label } : g)));
      commitSettled();
      void fetch(`/api/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      return;
    }

    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    if (label === item.label) return;
    setItemsBoth(itemsRef.current.map((i) => (i.id === id ? { ...i, label } : i)));
    commitSettled();
    void fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
  }, [commitSettled, labelEdit, setGroupsBoth, setItemsBoth]);

  const startItemLabelEdit = useCallback((item: ItemState) => {
    setLabelEdit({ id: item.id, draft: item.label, target: "item" });
  }, []);

  const cancelLabelEdit = useCallback(() => setLabelEdit(null), []);

  /* ---------- pointer interactions ---------- */

  const screenToBoard = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  /**
   * Remember a press without capturing the pointer yet. Capture is taken in
   * `onPointerMove` once the drag threshold is crossed, which keeps plain
   * clicks and double-clicks targeting the element under the pointer.
   */
  const queueDrag = useCallback(
    (
      e: ReactPointerEvent,
      drag: NonNullable<DragState>,
      activate: () => void = () => {}
    ) => {
      pendingRef.current = {
        drag,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        activate,
      };
    },
    []
  );

  const startMove = useCallback(
    (e: ReactPointerEvent, item: ItemState) => {
      if (e.button === 1) return; // middle button pans
      e.stopPropagation();

      select({ kind: "item", id: item.id });

      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);
      const maxZ = itemsRef.current.reduce((m, i) => Math.max(m, i.z), 0);
      const nextZ = item.z === maxZ ? item.z : maxZ + 1;
      if (nextZ !== item.z) {
        setItemsBoth(itemsRef.current.map((i) => (i.id === item.id ? { ...i, z: nextZ } : i)));
      }

      queueDrag(
        e,
        {
          kind: "move",
          id: item.id,
          dx: world.x - item.x,
          dy: world.y - item.y,
        },
        () => lockedRef.current.add(item.id)
      );
    },
    [queueDrag, screenToBoard, select, setItemsBoth]
  );

  const startResize = useCallback(
    (e: ReactPointerEvent, item: ItemState) => {
      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);
      queueDrag(
        e,
        {
          kind: "resize",
          id: item.id,
          startX: world.x,
          startY: world.y,
          aspect: item.height / item.width,
        },
        () => lockedRef.current.add(item.id)
      );
    },
    [queueDrag, screenToBoard]
  );

  const startGroupMove = useCallback(
    (e: ReactPointerEvent, group: GroupState) => {
      if (e.button === 1) return; // middle button pans
      e.stopPropagation();

      select({ kind: "group", id: group.id });

      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);

      const maxZ = groupsRef.current.reduce((m, g) => Math.max(m, g.z), 0);
      if (group.z !== maxZ) {
        setGroupsBoth(
          groupsRef.current.map((g) => (g.id === group.id ? { ...g, z: maxZ + 1 } : g))
        );
      }

      // Membership is geometric: images whose center is inside the box move
      // with it. Captured at drag start so the set doesn't shift mid-drag.
      const memberIds = itemsRef.current
        .filter((i) => rectContainsItemCenter(group, i))
        .map((i) => i.id);

      queueDrag(
        e,
        {
          kind: "group-move",
          id: group.id,
          dx: world.x - group.x,
          dy: world.y - group.y,
          memberIds,
        },
        () => {
          lockedRef.current.add(group.id);
          for (const id of memberIds) lockedRef.current.add(id);
        }
      );
    },
    [queueDrag, screenToBoard, select, setGroupsBoth]
  );

  const startGroupResize = useCallback(
    (e: ReactPointerEvent, group: GroupState) => {
      queueDrag(e, { kind: "group-resize", id: group.id }, () =>
        lockedRef.current.add(group.id)
      );
    },
    [queueDrag]
  );

  const startConnect = useCallback(
    (e: ReactPointerEvent, group: GroupState) => {
      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);
      queueDrag(e, { kind: "connect", fromId: group.id, x: world.x, y: world.y });
    },
    [queueDrag, screenToBoard]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      const onBackground = el === containerRef.current || el.dataset.background === "true";
      if (!(e.button === 1 || (e.button === 0 && onBackground))) return;
      e.preventDefault();
      if (e.button === 0) {
        select(null);
        commitLabelEdit(); // clicking away saves the label draft
      }
      const pan: NonNullable<DragState> = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        vx: viewportRef.current.x,
        vy: viewportRef.current.y,
      };
      if (e.button === 1) {
        // Middle-button pan starts at once; it can never be a double-click.
        containerRef.current?.setPointerCapture(e.pointerId);
        dragRef.current = pan;
        return;
      }
      queueDrag(e, pan);
    },
    [commitLabelEdit, queueDrag, select]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const board = screenToBoard(e.clientX, e.clientY);

      // A press becomes a drag only after the pointer travels far enough.
      // Until then the pointer is not captured, so clicks and double-clicks
      // keep their normal DOM target (inline label editing relies on it).
      const pending = pendingRef.current;
      if (pending && !dragRef.current) {
        cursorRef.current = toWorld(board.x, board.y, viewportRef.current);
        if (e.buttons === 0) {
          // Released before it ever became a drag.
          pendingRef.current = null;
          return;
        }
        if (
          !movedPastDragThreshold(
            { x: pending.startX, y: pending.startY },
            { x: e.clientX, y: e.clientY }
          )
        ) {
          return;
        }
        pendingRef.current = null;
        try {
          containerRef.current?.setPointerCapture(pending.pointerId);
        } catch {
          // Pointer already released outside the window.
        }
        dragRef.current = pending.drag;
        pending.activate();
      }

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
        const dragged = itemsRef.current.find((i) => i.id === drag.id);
        if (!dragged) return;
        const movedItem = { ...dragged, x: world.x - drag.dx, y: world.y - drag.dy };
        setItemsBoth(
          itemsRef.current.map((i) => (i.id === drag.id ? movedItem : i))
        );
        setBucketTargetId(topGroupContaining(groupsRef.current, movedItem)?.id ?? null);
      } else if (drag.kind === "resize") {
        const item = itemsRef.current.find((i) => i.id === drag.id);
        if (!item) return;
        const width = Math.min(MAX_DIM, Math.max(MIN_DIM, world.x - item.x));
        const height = Math.min(MAX_DIM, Math.max(MIN_DIM, width * drag.aspect));
        setItemsBoth(
          itemsRef.current.map((i) =>
            i.id === drag.id ? { ...i, width, height } : i
          )
        );
      } else if (drag.kind === "group-move") {
        const group = groupsRef.current.find((g) => g.id === drag.id);
        if (!group) return;
        const nextX = world.x - drag.dx;
        const nextY = world.y - drag.dy;
        const ddx = nextX - group.x;
        const ddy = nextY - group.y;
        setGroupsBoth(
          groupsRef.current.map((g) => (g.id === drag.id ? { ...g, x: nextX, y: nextY } : g))
        );
        const memberSet = new Set(drag.memberIds);
        setItemsBoth(
          itemsRef.current.map((i) =>
            memberSet.has(i.id) ? { ...i, x: i.x + ddx, y: i.y + ddy } : i
          )
        );
      } else if (drag.kind === "group-resize") {
        const group = groupsRef.current.find((g) => g.id === drag.id);
        if (!group) return;
        const width = Math.min(MAX_DIM, Math.max(MIN_GROUP_DIM, world.x - group.x));
        const height = Math.min(MAX_DIM, Math.max(MIN_GROUP_DIM, world.y - group.y));
        setGroupsBoth(
          groupsRef.current.map((g) => (g.id === drag.id ? { ...g, width, height } : g))
        );
      } else if (drag.kind === "connect") {
        dragRef.current = { ...drag, x: world.x, y: world.y };
        setConnectPoint(world);
      }
    },
    [screenToBoard, setGroupsBoth, setItemsBoth, updateViewport]
  );

  /**
   * Bucket behavior: when an image lands inside a group box, the box grows to
   * contain it (with a little clearance). Grow-only — the box never shrinks,
   * manual resizing stays authoritative for that.
   */
  const settleItemIntoBucket = useCallback(
    (item: ItemState) => {
      const owner = topGroupContaining(groupsRef.current, item);
      if (!owner) return;
      const grown = expandRectToContain(owner, item, GROUP_BUCKET_PADDING);
      const width = Math.min(MAX_DIM, grown.width);
      const height = Math.min(MAX_DIM, grown.height);
      if (
        grown.x === owner.x &&
        grown.y === owner.y &&
        width === owner.width &&
        height === owner.height
      ) {
        return;
      }
      setGroupsBoth(
        groupsRef.current.map((g) =>
          g.id === owner.id ? { ...g, x: grown.x, y: grown.y, width, height } : g
        )
      );
      void patchGroup(owner.id, { x: grown.x, y: grown.y, width, height });
    },
    [patchGroup, setGroupsBoth]
  );

  const finishDrag = useCallback(
    (e: ReactPointerEvent) => {
      // A press that never crossed the threshold is just a click.
      const pending = pendingRef.current;
      pendingRef.current = null;
      const drag = dragRef.current;
      dragRef.current = null;
      setBucketTargetId(null);

      if (!drag) {
        // Clicking still brings an item or group to the front, as before.
        if (pending) {
          const pressed = pending.drag;
          if (pressed.kind === "move") {
            const item = itemsRef.current.find((i) => i.id === pressed.id);
            if (item) void patchItem(item.id, { z: item.z });
          } else if (pressed.kind === "group-move") {
            const group = groupsRef.current.find((g) => g.id === pressed.id);
            if (group) void patchGroup(group.id, { z: group.z });
          }
        }
        return;
      }

      if (drag.kind === "move") {
        const item = itemsRef.current.find((i) => i.id === drag.id);
        if (item) {
          lockedRef.current.delete(drag.id);
          void patchItem(drag.id, { x: item.x, y: item.y, z: item.z });
          settleItemIntoBucket(item);
        }
      } else if (drag.kind === "resize") {
        const item = itemsRef.current.find((i) => i.id === drag.id);
        if (item) {
          lockedRef.current.delete(drag.id);
          void patchItem(drag.id, { width: item.width, height: item.height });
        }
      } else if (drag.kind === "group-move") {
        const group = groupsRef.current.find((g) => g.id === drag.id);
        lockedRef.current.delete(drag.id);
        for (const id of drag.memberIds) lockedRef.current.delete(id);
        if (group) {
          void patchGroup(drag.id, { x: group.x, y: group.y, z: group.z });
          for (const id of drag.memberIds) {
            const item = itemsRef.current.find((i) => i.id === id);
            if (item) void patchItem(id, { x: item.x, y: item.y });
          }
        }
      } else if (drag.kind === "group-resize") {
        const group = groupsRef.current.find((g) => g.id === drag.id);
        lockedRef.current.delete(drag.id);
        if (group) {
          void patchGroup(drag.id, { width: group.width, height: group.height });
        }
      } else if (drag.kind === "connect") {
        setConnectPoint(null);
        const board = screenToBoard(e.clientX, e.clientY);
        const world = toWorld(board.x, board.y, viewportRef.current);
        const target = groupsRef.current.find(
          (g) => g.id !== drag.fromId && pointInRect(world, g)
        );
        if (target) void createConnection(drag.fromId, target.id);
      }

      // One history entry per gesture. Connection drags commit inside
      // createConnection; pans and clicks never touch board content.
      if (drag.kind !== "connect" && drag.kind !== "pan") {
        commitSettled();
      }
    },
    [commitSettled, createConnection, patchGroup, patchItem, screenToBoard, settleItemIntoBucket]
  );

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
      const sel = selectionRef.current;
      if (e.key === "Escape") {
        select(null);
        setLabelEdit(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        if (sel.kind === "item") void deleteItem(sel.id);
        else if (sel.kind === "group") void deleteGroup(sel.id);
        else void deleteConnection(sel.id);
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        runHistory(e.shiftKey ? "redo" : "undo");
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        runHistory("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteConnection, deleteGroup, deleteItem, runHistory, select]);

  /* ---------- clipboard paste ---------- */

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Let inputs/textareas handle their own paste (labels, link dialog).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const { files, url } = extractPastePayload(e.clipboardData);
      if (files.length === 0 && !url) return;
      e.preventDefault();
      const center = centerWorld();
      if (files.length > 0) void uploadFiles(files, center.x, center.y);
      else void importFromUrl(url!, center.x, center.y);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [centerWorld, importFromUrl, uploadFiles]);

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
          groups?: GroupState[];
          deletedGroupIds?: string[];
          connections?: ConnectionState[];
          deletedConnectionIds?: string[];
          users: PresenceUser[];
          now: string;
        };
        sinceRef.current = data.now;
        setUsers(data.users);
        const locked = [...lockedRef.current];
        setItemsBoth(
          mergeRemoteItems(itemsRef.current, data.items, data.deletedIds, locked)
        );
        setGroupsBoth(
          mergeRemoteEntities(
            groupsRef.current,
            data.groups ?? [],
            data.deletedGroupIds ?? [],
            locked
          )
        );
        setConnectionsBoth(
          mergeRemoteEntities(
            connectionsRef.current,
            data.connections ?? [],
            data.deletedConnectionIds ?? [],
            []
          )
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
  }, [projectId, setConnectionsBoth, setGroupsBoth, setItemsBoth]);

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
    if (rect)
      updateViewport(
        fitViewport([...itemsRef.current, ...groupsRef.current], rect.width, rect.height)
      );
  };

  const v = viewport;
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  const sortedItems = [...items].sort((a, b) => a.z - b.z);
  const sortedGroups = [...groups].sort((a, b) => a.z - b.z);
  const groupsById = new Map(groups.map((g) => [g.id, g]));

  const connectDrag = dragRef.current?.kind === "connect" ? dragRef.current : null;
  const connectPreview: ConnectionPreview | null =
    connectDrag && connectPoint
      ? (() => {
          const from = groupsById.get(connectDrag.fromId);
          if (!from) return null;
          const { start, end } = edgeAnchors(from, {
            x: connectPoint.x,
            y: connectPoint.y,
            width: 0,
            height: 0,
          });
          return { from: start, to: end };
        })()
      : null;

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
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          void uploadFiles(files, world.x, world.y);
          return;
        }
        // Dragged a link/image from a browser page: uri-list first, plain text fallback.
        const dropped =
          e.dataTransfer.getData("text/uri-list").split(/\s+/)[0] ||
          e.dataTransfer.getData("text/plain");
        if (/^https?:\/\//i.test(dropped.trim())) {
          void importFromUrl(dropped.trim(), world.x, world.y);
        }
      }}
    >
      <div
        className="world"
        data-background="true"
        style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})` }}
      >
        {sortedGroups.map((group) => (
          <GroupBox
            key={group.id}
            group={group}
            selected={selection?.kind === "group" && selection.id === group.id}
            bucketTarget={bucketTargetId === group.id}
            editing={labelEdit?.id === group.id}
            draftLabel={labelEdit?.draft ?? ""}
            onGroupPointerDown={startGroupMove}
            onResizePointerDown={startGroupResize}
            onLinkPointerDown={startConnect}
            onLabelDoubleClick={(g) => setLabelEdit({ id: g.id, draft: g.label, target: "group" })}
            onLabelChange={(value) =>
              setLabelEdit((prev) => (prev ? { ...prev, draft: value } : prev))
            }
            onLabelCommit={commitLabelEdit}
            onLabelCancel={cancelLabelEdit}
          />
        ))}

        <ConnectionLayer
          connections={connections}
          groupsById={groupsById}
          selectedId={selection?.kind === "connection" ? selection.id : null}
          preview={connectPreview}
          onSelect={(id) => select({ kind: "connection", id })}
          onStyleToggle={(id) => void toggleConnectionStyle(id)}
        />

        {sortedItems.map((item) => (
          <BoardItem
            key={item.id}
            item={item}
            selected={selection?.kind === "item" && selection.id === item.id}
            editing={labelEdit?.target === "item" && labelEdit.id === item.id}
            draftLabel={labelEdit?.target === "item" ? (labelEdit?.draft ?? "") : ""}
            onItemPointerDown={startMove}
            onResizePointerDown={startResize}
            onLabelDoubleClick={startItemLabelEdit}
            onLabelChange={(value) =>
              setLabelEdit((prev) => (prev ? { ...prev, draft: value } : prev))
            }
            onLabelCommit={commitLabelEdit}
            onLabelCancel={cancelLabelEdit}
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

      {items.length === 0 && !uploading && !importingLink && (
        <div className="empty-hint">
          Drag & drop images or links onto this canvas — or use the actions on the
          left to upload or add a link.
        </div>
      )}
      {dropActive && <div className="drop-overlay">Drop to add images or links</div>}
      {(uploading || importingLink) && (
        <div className="upload-toast">{importingLink ? "Importing link…" : "Uploading…"}</div>
      )}

      <ActionBar
        uploading={uploading}
        importingLink={importingLink}
        onUploadClick={() => fileInputRef.current?.click()}
        onAddGroup={() => void addGroup()}
        onAddLink={(url) => {
          const center = centerWorld();
          return importFromUrl(url, center.x, center.y);
        }}
      />

      <ZoomControls
        zoomPercent={v.scale * 100}
        canUndo={canUndo}
        canRedo={canRedo}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
        onUndo={() => runHistory("undo")}
        onRedo={() => runHistory("redo")}
      />

      <div className="board-toolbar">
        <Toolbar project={project} activeUsers={users} />
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
