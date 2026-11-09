# Canvas notes — design

Date: 2026-11-09
Status: approved (autonomous session goal; approaches decided by the agent per standing user preference for terse autonomous execution)

## Intent

Add a simple sticky note to the moodboard canvas. Notes support rich text:
**bold**, *italic*, underline, ~~strikethrough~~, ordered lists, unordered
lists — plus a color picker for the note background.

## Goals

- A note is a first-class canvas object: drag, resize, z-order, group bucket,
  undo/redo, realtime sync, soft delete all work like existing items.
- Formatting exactly: B / I / U / S, ordered list, unordered list, color picker.
- No heavyweight editor dependency.

## Non-goals

- Text color, font size, headings, images in notes.
- Concurrent character-level collaboration on one note (last-writer-wins per
  commit, same as label editing today).
- Markdown source editing.

## Approaches considered

1. **contentEditable + document.execCommand, sanitized HTML in the item** (chosen).
   Zero new runtime deps for editing; the requested feature set maps 1:1 onto
   execCommand. HTML is sanitized server-side with `sanitize-html` (new dep)
   before storage, and client-side on paste with a DOMParser sanitizer sharing
   the same tag whitelist. Matches the app's minimal-dependency style.
2. Tiptap/ProseMirror — robust but a large new dependency graph for six
   commands; rejected.
3. Store markdown/plain text and render — cannot represent list/formatting
   edits in-place cleanly; rejected.

## Decided design

- **Data model**: `Item` gains `kind: "note"`, `content` (sanitized HTML,
  default `""`), `color` (hex string, default `#f6d660`). Notes keep the
  required `objectKey` slot with a unique placeholder `notes/{itemId}` (no
  storage object is written; storage route never touched) and placeholder
  `originalName`/`mime`/`size`, so existing required fields and indexes stay
  untouched.
- **API**: `POST /api/projects/[id]/items/notes` (JSON body: x, y, width?,
  height?, color?, content?) following the `from-url` route pattern. PATCH
  `/api/items/[id]` accepts `content` (sanitized, length-capped) and `color`
  (strictly `#rrggbb`), so notes ride the existing item pipeline including
  undo/redo restore bodies.
- **Client state**: `ItemState` gains `content` + `color`; `ITEM_FIELDS` in
  `history.ts` gains both so undo/redo diffs and restores include them.
- **Editing UX**: double-click a note to edit (matches the label convention).
  While editing, a floating toolbar docks above the note: B, I, U, S, OL, UL
  buttons (`onPointerDown` + `preventDefault` keeps the text selection) and
  the color picker (8 preset swatches + native `<input type="color">`).
  Commit on blur / click-away, Esc cancels. While editing, the note cannot be
  dragged — same as label editing on images.
- **Color picker**: changes the note background; presets patch immediately,
  the custom picker patches debounced; every change is a history entry.
- **Resize**: notes resize height freely (width from pointer, height
  independent); image items keep the aspect-locked behavior.
- **Keyboard/paste guards**: board-level Delete/Backspace, undo/redo, and
  paste handlers skip `contentEditable` targets so typing in a note never
  deletes the note or hijacks native text undo.
- **Sanitization**: shared whitelist `b strong i em u s strike del ol ul li br
  p div`, no attributes. Server: `sanitize-html`. Client paste: DOMParser
  walker (drops script/style subtrees, strips attributes).

## Left to the builder

- Exact CSS to match the existing dark theme and card styling.
- Test fixture updates wherever `ItemState` literals are constructed.

## Tests

- `tests/note-content.test.ts` — whitelist sanitizer, color validation, caps.
- `tests/note-item-api.test.ts` — note creation route, PATCH content/color,
  sanitization via API, sync returns notes.
- `tests/board-ui-render.test.ts` — note card renders color/content; editor
  renders toolbar + contentEditable; fixture gains the new fields.
