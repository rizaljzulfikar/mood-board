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
import { applyPresenceEvent, applyRealtimeEvent, presenceFromHttp } from "@/lib/realtime-client";
import type { PresenceUser, ServerMessage } from "@/lib/realtime-protocol";
import { edgeAnchors, expandRectToContain, fitRectAroundItems, minGroupSizeForItems, pointInRect, rectContainsItemCenter, topGroupContaining } from "@/lib/geometry";
import { cropEdgeGeometry, LINK_FOOTER_HEIGHT, type CropEdge, type CropGeometry } from "@/lib/crop";
import { movedPastDragThreshold } from "@/lib/drag";
import { extractPastePayload } from "@/lib/clipboard";
import {
  ReplayQueue,
  commitHistory,
  initHistory,
  planServerOps,
  redoHistory,
  undoHistory,
  waitForSettled,
  type HistoryStack,
  type ServerOp,
  type Snapshot,
} from "@/lib/history";
import { fitViewport, toScreen, toWorld, wheelToViewport, zoomAt, type Viewport } from "@/lib/viewport";
import { NOTE_DEFAULT_HEIGHT, NOTE_DEFAULT_WIDTH, cleanNoteColor } from "@/lib/note-format";
import {
  createViewportSaver,
  getLocalStorage,
  loadViewport,
  type ViewportSaver,
} from "@/lib/viewport-storage";
import { BoardItem } from "./BoardItem";
import { GroupBox } from "./GroupBox";
import { ConnectionLayer, type ConnectionPreview } from "./ConnectionLayer";
import { Toolbar, type ProjectInfo } from "./Toolbar";
import { ActionBar } from "./ActionBar";
import { ZoomControls } from "./ZoomControls";

const SYNC_INTERVAL_MS = 2000;
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;
const CURSOR_THROTTLE_MS = 50;
const ZOOM_STEP = 1.1;
const MIN_DIM = 24;
const MAX_DIM = 8000;
const MIN_GROUP_DIM = 60;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const GROUP_BUCKET_PADDING = 32;
const NEW_GROUP_WIDTH = 360;
const NEW_GROUP_HEIGHT = 240;
const NOTE_WIDTH = NOTE_DEFAULT_WIDTH;
const NOTE_HEIGHT = NOTE_DEFAULT_HEIGHT;

type Selection = { kind: "item" | "group" | "connection"; id: string } | null;

type DragState =
  | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; startX: number; startY: number; aspect: number; freeHeight: boolean }
  | {
      kind: "crop";
      id: string;
      edge: CropEdge;
      startX: number;
      startY: number;
      /** Non-image chrome below the cropped image (link-card footer). */
      bottomInset: number;
      from: CropGeometry;
    }
  | { kind: "group-move"; id: string; dx: number; dy: number; memberIds: string[] }
  | { kind: "group-resize"; id: string; memberIds: string[] }
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
  user: { id: string; email: string; name: string };
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

  // Membership lives in local state so the realtime `project:members` event
  // can update it live. Refreshed server props stay authoritative (React's
  // adjust-state-on-prop-change pattern): SSR data is fetched after the
  // mutation, so overwriting a racing WS update is safe.
  const [projectInfo, setProjectInfo] = useState(project);
  const [prevProjectProp, setPrevProjectProp] = useState(project);
  if (prevProjectProp !== project) {
    setPrevProjectProp(project);
    setProjectInfo(project);
  }

  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport);
  const viewportSaverRef = useRef<ViewportSaver | null>(null);

  const [selection, setSelection] = useState<Selection>(null);
  const selectionRef = useRef<Selection>(null);
  const [cropEditId, setCropEditId] = useState<string | null>(null);
  const select = useCallback((next: Selection) => {
    selectionRef.current = next;
    setSelection(next);
    // Crop handles belong to one item; selecting anything else leaves the mode.
    setCropEditId((current) =>
      current && !(next?.kind === "item" && next.id === current) ? null : current
    );
  }, []);

  const [labelEdit, setLabelEdit] = useState<{
    id: string;
    draft: string;
    target: "group" | "item";
  } | null>(null);
  // Note being edited plus a mirrored draft (kept fresh via onInput) so a
  // click on the pan/select background — which preventDefaults pointerdown
  // and thus suppresses blur — can still commit the latest content.
  const [noteEdit, setNoteEdit] = useState<{ id: string; draft: string } | null>(null);
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
  const socketRef = useRef<WebSocket | null>(null);
  const lastCursorSentRef = useRef(0);

  const sendCursor = useCallback((cursor: { x: number; y: number }) => {
    const socket = socketRef.current;
    const now = Date.now();
    if (!socket || socket.readyState !== WebSocket.OPEN || now - lastCursorSentRef.current < CURSOR_THROTTLE_MS) {
      return;
    }
    lastCursorSentRef.current = now;
    socket.send(JSON.stringify({ type: "cursor", cursor }));
  }, []);

  /* ---------- undo / redo history ---------- */

  const historyRef = useRef<HistoryStack>(
    initHistory({ items: initialItems, groups: initialGroups, connections: initialConnections })
  );
  // Bumped whenever the stacks change so button disabled-states re-render.
  const [, setHistTick] = useState(0);
  // User-initiated content writes still in flight; a server replay must wait
  // for them, or the original mutation can land after it and undo the undo.
  const inflightRef = useRef<Set<Promise<unknown>>>(new Set());
  const replayQueueRef = useRef<ReplayQueue>(new ReplayQueue());

  /** Register a write so replays know to wait for it. Never rejects. */
  const track = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    inflightRef.current.add(p);
    void p.catch(() => {}).then(() => {
      inflightRef.current.delete(p);
    });
    return p;
  }, []);

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

  const applyServerOps = useCallback(
    async (ops: ServerOp[]) => {
      for (const op of ops) {
        const p = fetch(`/api/${op.kind}s/${op.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op.body),
        }).catch(() => {});
        inflightRef.current.add(p);
        void p.then(() => {
          inflightRef.current.delete(p);
        });
        await p;
      }
    },
    []
  );

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
      // Replay waits for in-flight user writes and any earlier replay, so a
      // late DELETE can never land after its own undo and re-delete the
      // restored entity.
      replayQueueRef.current.enqueue(async () => {
        await waitForSettled(inflightRef.current);
        await applyServerOps(planServerOps(result.target, current));
      });
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
    viewportSaverRef.current?.schedule(v);
    setViewport(v);
  }, []);

  /* ---------- viewport persistence ---------- */

  // Restore this project's last viewport after hydration, then keep it saved.
  // Restoring in an effect (not initial state) keeps the first client render
  // identical to the server-rendered markup, so there is no hydration mismatch.
  useEffect(() => {
    const storage = getLocalStorage();
    const saved = loadViewport(storage, projectId);
    if (saved) {
      viewportRef.current = saved;
      setViewport(saved);
    }

    const saver = createViewportSaver(storage, projectId);
    viewportSaverRef.current = saver;

    const flush = () => saver.flush();
    const onVisibilityChange = () => {
      // Mobile browsers may never fire pagehide; a tab switch is the last
      // reliable moment to persist the position.
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (viewportSaverRef.current === saver) viewportSaverRef.current = null;
    };
  }, [projectId]);

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
            setItemsBoth(mergeRemoteItems(itemsRef.current, [data.item], [], [...lockedRef.current]));
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
    async (
      id: string,
      patch: Partial<Pick<ItemState, "x" | "y" | "width" | "height" | "z" | "crop">>
    ) => {
      const res = await track(
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      );
      if (res.status === 404) {
        // Deleted by a teammate while we were dragging it.
        setItemsBoth(itemsRef.current.filter((i) => i.id !== id));
      }
    },
    [setItemsBoth, track]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      setItemsBoth(itemsRef.current.filter((i) => i.id !== id));
      commitSettled();
      if (selectionRef.current?.kind === "item" && selectionRef.current.id === id) {
        select(null);
      }
      if (noteEdit?.id === id) setNoteEdit(null);
      await track(fetch(`/api/items/${id}`, { method: "DELETE" }));
    },
    [commitSettled, noteEdit?.id, select, setItemsBoth, track]
  );

  const patchGroup = useCallback(
    async (
      id: string,
      patch: Partial<Pick<GroupState, "x" | "y" | "width" | "height" | "z" | "label">>
    ) => {
      const res = await track(
        fetch(`/api/groups/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      );
      if (res.status === 404) {
        // Deleted by a teammate while we were dragging it.
        setGroupsBoth(groupsRef.current.filter((g) => g.id !== id));
        setConnectionsBoth(
          connectionsRef.current.filter((c) => c.from !== id && c.to !== id)
        );
      }
    },
    [setConnectionsBoth, setGroupsBoth, track]
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      // Images stay on the canvas; only the box and its connections go away.
      setGroupsBoth(groupsRef.current.filter((g) => g.id !== id));
      setConnectionsBoth(connectionsRef.current.filter((c) => c.from !== id && c.to !== id));
      commitSettled();
      if (selectionRef.current?.id === id) select(null);
      if (labelEdit?.id === id) setLabelEdit(null);
      await track(fetch(`/api/groups/${id}`, { method: "DELETE" }));
    },
    [commitSettled, labelEdit?.id, select, setConnectionsBoth, setGroupsBoth, track]
  );

  const deleteConnection = useCallback(
    async (id: string) => {
      setConnectionsBoth(connectionsRef.current.filter((c) => c.id !== id));
      commitSettled();
      if (selectionRef.current?.kind === "connection" && selectionRef.current.id === id) {
        select(null);
      }
      await track(fetch(`/api/connections/${id}`, { method: "DELETE" }));
    },
    [commitSettled, select, setConnectionsBoth, track]
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
      await track(
        fetch(`/api/connections/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ style }),
        })
      );
    },
    [commitSettled, setConnectionsBoth, track]
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
      // Merge, don't append: the hub echoes our own creation back, and the
      // echo can beat the POST response (duplicate React keys otherwise).
      setConnectionsBoth(
        mergeRemoteEntities(connectionsRef.current, [data.connection], [], [])
      );
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
    setGroupsBoth(mergeRemoteEntities(groupsRef.current, [data.group], [], [...lockedRef.current]));
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
        setItemsBoth(mergeRemoteItems(itemsRef.current, [data.item], [], [...lockedRef.current]));
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
      void track(
        fetch(`/api/groups/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        })
      );
      return;
    }

    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    if (label === item.label) return;
    setItemsBoth(itemsRef.current.map((i) => (i.id === id ? { ...i, label } : i)));
    commitSettled();
    void track(
      fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      })
    );
  }, [commitSettled, labelEdit, setGroupsBoth, setItemsBoth, track]);

  const startItemLabelEdit = useCallback((item: ItemState) => {
    setLabelEdit({ id: item.id, draft: item.label, target: "item" });
  }, []);

  const cancelLabelEdit = useCallback(() => setLabelEdit(null), []);

  /* ---------- note editing ---------- */

  /** Double-click entry point for both notes and image/link labels. */
  const startItemEdit = useCallback(
    (item: ItemState) => {
      if (item.kind === "note") setNoteEdit({ id: item.id, draft: item.content });
      else startItemLabelEdit(item);
    },
    [startItemLabelEdit]
  );

  const changeNoteEdit = useCallback((item: ItemState, html: string) => {
    setNoteEdit((prev) => (prev && prev.id === item.id ? { ...prev, draft: html } : prev));
  }, []);

  /** Persist note content if it actually changed; the caller exits edit mode. */
  const commitNoteContent = useCallback(
    (id: string, html: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || item.kind !== "note") return;
      if (html === item.content) return;
      setItemsBoth(itemsRef.current.map((i) => (i.id === id ? { ...i, content: html } : i)));
      commitSettled();
      void track(
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: html }),
        })
      );
    },
    [commitSettled, setItemsBoth, track]
  );

  /** Blur commit: the DOM holds the truth, use it directly. */
  const commitNoteHtml = useCallback(
    (item: ItemState, html: string) => {
      setNoteEdit((prev) => (prev && prev.id === item.id ? null : prev));
      commitNoteContent(item.id, html);
    },
    [commitNoteContent]
  );

  /** Background-click commit: uses the mirrored draft (blur never fired). */
  const commitNoteEdit = useCallback(() => {
    if (!noteEdit) return;
    const { id, draft } = noteEdit;
    setNoteEdit(null);
    commitNoteContent(id, draft);
  }, [commitNoteContent, noteEdit]);

  const cancelNoteEdit = useCallback(() => setNoteEdit(null), []);

  /** Color presets and picker drags stream many values; one PATCH per pause. */
  const colorPatchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = colorPatchTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const changeNoteColor = useCallback(
    (item: ItemState, color: string) => {
      const clean = cleanNoteColor(color);
      if (!clean) return;
      const current = itemsRef.current.find((i) => i.id === item.id);
      if (!current || current.color === clean) return;
      setItemsBoth(itemsRef.current.map((i) => (i.id === item.id ? { ...i, color: clean } : i)));
      const timers = colorPatchTimersRef.current;
      const existing = timers.get(item.id);
      if (existing) clearTimeout(existing);
      timers.set(
        item.id,
        setTimeout(() => {
          timers.delete(item.id);
          commitSettled();
          void track(
            fetch(`/api/items/${item.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ color: clean }),
            })
          );
        }, 250)
      );
    },
    [commitSettled, setItemsBoth, track]
  );

  const addNote = useCallback(async () => {
    const center = centerWorld();
    const res = await fetch(`/api/projects/${projectId}/items/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x: Math.round(center.x - NOTE_WIDTH / 2),
        y: Math.round(center.y - NOTE_HEIGHT / 2),
        width: NOTE_WIDTH,
        height: NOTE_HEIGHT,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { item: ItemState };
    setItemsBoth(mergeRemoteItems(itemsRef.current, [data.item], [], [...lockedRef.current]));
    commitSettled();
    select({ kind: "item", id: data.item.id });
    setNoteEdit({ id: data.item.id, draft: data.item.content });
  }, [centerWorld, commitSettled, projectId, select, setItemsBoth]);

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
          // Notes resize height independently; images stay aspect-locked.
          freeHeight: item.kind === "note",
        },
        () => lockedRef.current.add(item.id)
      );
    },
    [queueDrag, screenToBoard]
  );

  /** Double-clicking the resize handle toggles four-edge crop mode. */
  const toggleCrop = useCallback(
    (item: ItemState) => {
      if (item.kind === "note") return; // notes have no image to crop
      select({ kind: "item", id: item.id });
      setCropEditId((current) => (current === item.id ? null : item.id));
    },
    [select]
  );

  const startCropResize = useCallback(
    (e: ReactPointerEvent, item: ItemState, edge: CropEdge) => {
      const board = screenToBoard(e.clientX, e.clientY);
      const world = toWorld(board.x, board.y, viewportRef.current);
      queueDrag(
        e,
        {
          kind: "crop",
          id: item.id,
          edge,
          startX: world.x,
          startY: world.y,
          bottomInset: item.kind === "link" ? LINK_FOOTER_HEIGHT : 0,
          from: {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            crop: item.crop,
          },
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
      // Contents captured at drag start: the box may not be dragged smaller
      // than the images it holds, and the set must not shift mid-drag.
      const memberIds = itemsRef.current
        .filter((i) => rectContainsItemCenter(group, i))
        .map((i) => i.id);
      queueDrag(e, { kind: "group-resize", id: group.id, memberIds }, () =>
        lockedRef.current.add(group.id)
      );
    },
    [queueDrag]
  );

  /**
   * Double-clicking the group resize handle fits the box to its contents on
   * all four sides: the box moves and resizes so every image whose center it
   * holds sits exactly `GROUP_BUCKET_PADDING` from each edge (never below
   * MIN_GROUP_DIM). Images keep their positions. A group larger than its
   * images stays larger until this is used.
   */
  const fitGroupToContent = useCallback(
    (group: GroupState) => {
      const members = itemsRef.current.filter((i) => rectContainsItemCenter(group, i));
      const fitted = fitRectAroundItems(members, GROUP_BUCKET_PADDING, MIN_GROUP_DIM);
      if (!fitted) return;
      const next = {
        x: fitted.x,
        y: fitted.y,
        width: Math.min(MAX_DIM, fitted.width),
        height: Math.min(MAX_DIM, fitted.height),
      };
      if (
        next.x === group.x &&
        next.y === group.y &&
        next.width === group.width &&
        next.height === group.height
      ) {
        return;
      }
      setGroupsBoth(
        groupsRef.current.map((g) => (g.id === group.id ? { ...g, ...next } : g))
      );
      void patchGroup(group.id, next);
      commitSettled();
    },
    [commitSettled, patchGroup, setGroupsBoth]
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
        commitNoteEdit(); // …and the note draft (blur is suppressed by preventDefault)
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
    [commitLabelEdit, commitNoteEdit, queueDrag, select]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const board = screenToBoard(e.clientX, e.clientY);

      // A press becomes a drag only after the pointer travels far enough.
      // Until then the pointer is not captured, so clicks and double-clicks
      // keep their normal DOM target (inline label editing relies on it).
      const pending = pendingRef.current;
      if (pending && !dragRef.current) {
        const world = toWorld(board.x, board.y, viewportRef.current);
        cursorRef.current = world;
        sendCursor(world);
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
        sendCursor(world);
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
        const height = drag.freeHeight
          ? Math.min(MAX_DIM, Math.max(MIN_DIM, world.y - item.y))
          : Math.min(MAX_DIM, Math.max(MIN_DIM, width * drag.aspect));
        setItemsBoth(
          itemsRef.current.map((i) =>
            i.id === drag.id ? { ...i, width, height } : i
          )
        );
      } else if (drag.kind === "crop") {
        const next = cropEdgeGeometry(
          drag.from,
          drag.edge,
          world.x - drag.startX,
          world.y - drag.startY,
          MIN_DIM,
          drag.bottomInset
        );
        setItemsBoth(
          itemsRef.current.map((i) =>
            i.id === drag.id
              ? { ...i, x: next.x, y: next.y, width: next.width, height: next.height, crop: next.crop }
              : i
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
        const memberIds = new Set(drag.memberIds);
        const members = itemsRef.current.filter((i) => memberIds.has(i.id));
        const min = minGroupSizeForItems(
          group,
          members,
          GROUP_BUCKET_PADDING,
          MIN_GROUP_DIM
        );
        const width = Math.min(MAX_DIM, Math.max(min.width, world.x - group.x));
        const height = Math.min(MAX_DIM, Math.max(min.height, world.y - group.y));
        setGroupsBoth(
          groupsRef.current.map((g) => (g.id === drag.id ? { ...g, width, height } : g))
        );
      } else if (drag.kind === "connect") {
        dragRef.current = { ...drag, x: world.x, y: world.y };
        setConnectPoint(world);
      }
    },
    [screenToBoard, sendCursor, setGroupsBoth, setItemsBoth, updateViewport]
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
          // Click-to-front is a z-order edit, so it is undoable too. The
          // dedupe in commitHistory makes this a no-op for clicks that
          // changed nothing (top item, resize handle, background pan).
          commitSettled();
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
      } else if (drag.kind === "crop") {
        const item = itemsRef.current.find((i) => i.id === drag.id);
        if (item) {
          lockedRef.current.delete(drag.id);
          void patchItem(drag.id, {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            crop: item.crop,
          });
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

  /* ---------- wheel: plain scroll pans, ctrl/cmd (or pinch) zooms ---------- */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Keep the browser from page-scrolling / page-zooming over the canvas.
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      updateViewport(
        wheelToViewport(viewportRef.current, {
          cursorX: e.clientX - rect.left,
          cursorY: e.clientY - rect.top,
          width: rect.width,
          height: rect.height,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
        })
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [updateViewport]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Inputs and the note editor own their keys: typing Delete must not
      // delete the note, and Ctrl+Z must stay native text undo.
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
        return;
      const sel = selectionRef.current;
      if (e.key === "Escape") {
        select(null);
        setLabelEdit(null);
        setNoteEdit(null);
        setCropEditId(null);
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
      // Let inputs and the note editor handle their own paste.
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
        return;
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
    let socket: WebSocket | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 500;
    let syncInFlight = false;
    let syncQueued = false;
    let syncGeneration = 0;

    const applySync = (data: {
      items: ItemState[];
      deletedIds: string[];
      groups?: GroupState[];
      deletedGroupIds?: string[];
      connections?: ConnectionState[];
      deletedConnectionIds?: string[];
      users: PresenceUser[];
      now: string;
    }) => {
      if (stopped) return;
      sinceRef.current = data.now;
      setUsers((current) => presenceFromHttp(current, data.users, socket?.readyState === WebSocket.OPEN));
      const locked = [...lockedRef.current];
      setItemsBoth(mergeRemoteItems(itemsRef.current, data.items, data.deletedIds, locked));
      setGroupsBoth(
        mergeRemoteEntities(groupsRef.current, data.groups ?? [], data.deletedGroupIds ?? [], locked)
      );
      setConnectionsBoth(
        mergeRemoteEntities(
          connectionsRef.current,
          data.connections ?? [],
          data.deletedConnectionIds ?? [],
          []
        )
      );
    };

    const poll = async () => {
      if (stopped) return;
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      const requestGeneration = syncGeneration;
      try {
        const res = await fetch(`/api/projects/${projectId}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ since: sinceRef.current, cursor: cursorRef.current }),
        });
        if (!res.ok || stopped) return;
        const data = (await res.json()) as Parameters<typeof applySync>[0];
        if (requestGeneration === syncGeneration) applySync(data);
        else syncQueued = true;
      } catch {
        /* transient network error — next tick retries */
      } finally {
        syncInFlight = false;
        if (syncQueued && !stopped) {
          syncQueued = false;
          void poll();
        }
      }
    };

    const startFallback = () => {
      if (stopped) return;
      if (fallbackInterval === null) fallbackInterval = setInterval(poll, SYNC_INTERVAL_MS);
    };
    const connect = async () => {
      if (stopped || !REALTIME_URL) return;
      try {
        const res = await fetch(`/api/projects/${projectId}/realtime-ticket`);
        if (!res.ok || stopped) throw new Error("realtime ticket request failed");
        const { ticket } = (await res.json()) as { ticket: string };
        if (stopped) return;
        const ws = new WebSocket(`${REALTIME_URL}?ticket=${encodeURIComponent(ticket)}`);
        socket = ws;
        socketRef.current = ws;
        ws.onopen = () => {
          reconnectDelay = 500;
          if (fallbackInterval !== null) {
            clearInterval(fallbackInterval);
            fallbackInterval = null;
          }
          void poll();
        };
        ws.onmessage = (event) => {
          if (stopped) return;
          let message: ServerMessage;
          try {
            message = JSON.parse(event.data as string) as ServerMessage;
          } catch {
            return;
          }
          if (message.type.startsWith("presence:")) {
            setUsers((current) => applyPresenceEvent(current, message, user.id));
            return;
          }
          if (message.type === "project:deleted") {
            window.location.assign("/projects");
            return;
          }
          if (message.type === "project:members") {
            if (message.removedUserIds.includes(user.id)) {
              // Membership revoked (removed or left from another device).
              ws.close();
              window.location.assign("/projects");
              return;
            }
            setProjectInfo((current) => ({ ...current, members: message.members }));
            return;
          }
          const next = applyRealtimeEvent(
            { items: itemsRef.current, groups: groupsRef.current, connections: connectionsRef.current },
            message,
            [...lockedRef.current]
          );
          syncGeneration += 1;
          setItemsBoth(next.items);
          setGroupsBoth(next.groups);
          setConnectionsBoth(next.connections);
        };
        ws.onerror = () => ws.close();
        ws.onclose = () => {
          if (socketRef.current === ws) socketRef.current = null;
          if (stopped) return;
          startFallback();
          if (reconnectTimer === null) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
              void connect();
            }, reconnectDelay);
          }
        };
      } catch {
        if (stopped) return;
        startFallback();
        if (!stopped && reconnectTimer === null) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
            void connect();
          }, reconnectDelay);
        }
      }
    };

    void poll();
    if (REALTIME_URL) void connect();
    else startFallback();
    return () => {
      stopped = true;
      if (fallbackInterval !== null) clearInterval(fallbackInterval);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socket = null;
    };
  }, [projectId, setConnectionsBoth, setGroupsBoth, setItemsBoth, user.id]);

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
            scale={v.scale}
            selected={selection?.kind === "group" && selection.id === group.id}
            bucketTarget={bucketTargetId === group.id}
            editing={labelEdit?.id === group.id}
            draftLabel={labelEdit?.draft ?? ""}
            onGroupPointerDown={startGroupMove}
            onResizePointerDown={startGroupResize}
            onResizeDoubleClick={fitGroupToContent}
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
            scale={v.scale}
            selected={selection?.kind === "item" && selection.id === item.id}
            cropping={cropEditId === item.id}
            editing={
              item.kind === "note"
                ? noteEdit?.id === item.id
                : labelEdit?.target === "item" && labelEdit.id === item.id
            }
            draftLabel={labelEdit?.target === "item" ? (labelEdit?.draft ?? "") : ""}
            onItemPointerDown={startMove}
            onResizePointerDown={startResize}
            onCropToggle={toggleCrop}
            onCropPointerDown={startCropResize}
            onLabelDoubleClick={startItemEdit}
            onLabelChange={(value) =>
              setLabelEdit((prev) => (prev ? { ...prev, draft: value } : prev))
            }
            onLabelCommit={commitLabelEdit}
            onLabelCancel={cancelLabelEdit}
            onNoteChange={changeNoteEdit}
            onNoteCommit={commitNoteHtml}
            onNoteCancel={cancelNoteEdit}
            onNoteColorChange={changeNoteColor}
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
          left to upload, add a link, or add a note.
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
        onAddNote={() => void addNote()}
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
        <Toolbar project={projectInfo} activeUsers={users} user={user} />
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
