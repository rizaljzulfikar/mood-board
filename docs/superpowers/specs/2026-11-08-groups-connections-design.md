# Group Boxes + Connections — Design

**Date:** 2026-11-08
**Status:** Approved by directive (user opted out of brainstorming questions: "Start now… do not stop to ask"). Approach calls below were made by the agent and are documented for review.

## Intent & Why

On the shared moodboard canvas, users need to organize reference images into labeled
**group boxes** (containers) and express relationships between those groups with
**lines / arrows** — turning a flat image pile into a readable moodboard structure
(e.g. "Material mood" → "Color story").

## Goals

- Group box: labeled rectangle on the canvas; create, move, resize, edit label, delete.
- Grouping: images whose **center** lies inside the box belong to it; moving the box
  moves its member images with it (Figma-frame-like behavior).
- Connections: a directed link between two groups, rendered as an **arrow** (default)
  or a plain **line** (toggle); create by dragging from a group's link handle to
  another group; select + Delete to remove; double-click toggles arrow ↔ line.
- Collaborative: groups and connections sync through the existing 2 s polling delta
  mechanism, soft-deleted like items.

## Non-Goals

- No connection labels (labels are for boxes).
- No nested groups, no group styles/colors beyond a fixed look.
- No membership persistence — membership is geometric (derived), not stored.
- No multi-select / batch operations.

## Approaches Considered

1. **Discriminated `Item` documents (`kind: "image" | "group"`)** — rejected: `Item`
   is image-specific (`objectKey`/`mime`/`size` required, unique); a discriminator
   would leak into every query, serializer, and upload path.
2. **Stored membership array on the group** — rejected: every drag would need
   transactional membership writes, sync grows a third delta kind per image, and
   membership can drift from what the user sees.
3. **Chosen: separate `Group` + `Connection` models; membership is geometric
   (center-in-rect, computed client-side).** Zero migration for existing boards,
   no membership writes, and "what you see in the box is what moves with it".

## Data Model (Mongoose)

- `Group { project→Project, label (trim, ≤120), x, y, width, height, z,
  addedBy→User, deletedAt?, createdAt, updatedAt }`
- `Connection { project→Project, from→Group, to→Group, style: "arrow" | "line"
  (default "arrow"), addedBy→User, deletedAt?, createdAt, updatedAt }`
- Deleting a group soft-deletes its connections (server-side, same request).
- JSON uses `id` like items; `from`/`to` are stringified group ids.

## API Surface (mirrors items patterns: `requireMember`, soft delete, clamps)

- `POST /api/projects/:id/groups {x,y,width,height,label?}` (+ `GET` for parity)
- `PATCH /api/groups/:id {x?,y?,width?,height?,label?,z?}` · `DELETE` (soft; cascades to connections)
- `POST /api/projects/:id/connections {fromId,toId,style?}` (from ≠ to, both live, same project)
- `PATCH /api/connections/:id {style?}` · `DELETE` (soft)
- `POST /api/projects/:id/sync` response gains `groups`, `deletedGroupIds`,
  `connections`, `deletedConnectionIds` deltas (same `updatedAt > since` pattern).
- Project page loads initial groups/connections server-side.

## Client

- `merge.ts`: generic `mergeRemoteEntities` (same semantics as `mergeRemoteItems`,
  which becomes a thin wrapper); `GroupState`, `ConnectionState` types.
- `GroupBox.tsx`: box + label header (inline edit on double-click, Enter/blur saves,
  Escape cancels), resize handle, link handle (starts connection drag).
- `ConnectionLayer.tsx`: one SVG (0×0, `overflow: visible`) in world coordinates;
  lines with arrowhead markers, 16 px transparent hit paths, rubber-band preview.
- `Board.tsx`: selection becomes `{kind: "item"|"group"|"connection", id}`;
  drag kinds gain `group-move` (moves group + captured members), `group-resize`,
  `connect`. Locks use the same `lockedRef` set (ids never collide across models).
- Render order: groups (z-sorted) → connections SVG → images → presence cursors.
- Toolbar gains "Add group" (creates a 360×240 box at viewport center).
- Zoom-to-fit includes group bounds.

## Left to the Builder

Exact CSS look within the existing dark PureRef theme, copy, minor polish.
