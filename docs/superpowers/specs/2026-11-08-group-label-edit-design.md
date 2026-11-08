# Group label editing: make double-click rename actually work — design

Date: 2026-11-08

## Intent

Users can already select, move, resize, and delete group boxes, but there is no
working way to rename a group. The intended interaction (inline edit on
double-click, Enter/blur saves, Escape cancels) is already implemented in
`GroupBox.tsx` and `Board.tsx`, but it never triggers.

Root cause, reproduced in headless Chrome: `startGroupMove` calls
`containerRef.setPointerCapture()` on `pointerdown`. Pointer capture retargets
the compatibility mouse events to the board container, so the second click's
target is the container and the `dblclick` lands there instead of on the group
box. The same bug affects item labels (`BoardItem`).

## Goals

- Double-clicking a group's label header opens the existing inline editor.
- Enter or blur saves, Escape cancels — unchanged.
- Item labels (which share the bug) start working too.
- Dragging, resizing, connecting, and panning keep their current feel.

## Non-goals

- No new rename button, dialog, or single-click edit mode.
- No change to label persistence (`PATCH /api/groups/:id`, `PATCH /api/items/:id`).
- No change to the label UI or CSS.

## Approaches considered

1. **Defer pointer capture until the pointer moves past a small threshold
   (chosen).** On `pointerdown`, record a pending drag and select, but do not
   capture or move anything. On the first `pointermove` beyond ~4 px, capture
   the pointer and activate the drag. A click that never moves stays a click,
   so the browser dispatches `click`/`dblclick` on the real target and the
   existing double-click handlers fire. This is the standard drag-threshold
   pattern and fixes every mouse interaction at once.
2. Custom double-click detection inside `pointerdown` (timestamp + target
   matching). Works, but duplicates browser behavior, adds state, and leaves
   `click`/`dblclick` broken for anything else.
3. Listen for `dblclick` on the board container and hit-test the pointer
   position. Fixes rename only, bypasses the DOM's own target, and duplicates
   geometry hit-testing already used elsewhere.

Approach 1 wins: smallest conceptual change, keeps the documented interaction,
and repairs item labels without extra code.

## How

- In `Board.tsx`, add a `pendingRef` holding the drag descriptor, start
  coordinates, and pointer id. The pointer-down handlers (`startMove`,
  `startGroupMove`, `startGroupResize`, `startConnect`, background pan) fill it
  instead of capturing immediately. Middle-button pan keeps immediate capture.
- Side effects that only matter once a drag starts (pointer capture, `lockedRef`
  entries, z-order raise, group member capture) move to activation.
- `onPointerMove` activates a pending drag after `DRAG_THRESHOLD_PX` (4 px);
  `onPointerUp` clears an unactivated pending drag.
- Selection still happens on pointer-down, so a plain click selects as today.
- A pure helper for the threshold check lives in `src/lib/geometry.ts` (or a
  small drag helper) so it can be unit-tested in the node test environment.

## Verification

- `npx tsc --noEmit`
- Targeted vitest for the new helper plus the existing geometry suite.
- Manual/headless browser check: double-click the group header opens the input;
  drag still moves the group; a click does not.

## Left to the builder

Exact threshold value (4 px proposed), helper placement, and whether to keep the
`title="Double-click to rename"` hint as is.
