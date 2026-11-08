# Link import: URL cards, image imports, item labels — design

Date: 2026-11-08
Status: implemented (autonomous session; user directive: proceed without interactive review)

## Intent

Let users bring outside content onto the board by pasting a link:

1. **Page link (e.g. an Instagram post)** → becomes a proper card item: thumbnail
   on top, caption footer below (title / site name / "Open ↗"), like an OG embed.
2. **Direct image link** → the image is fetched server-side and imported into
   MinIO file storage as a regular image item (same as an upload).
3. **Labels** → every item (image or link card) gets a user-editable label,
   mirroring the existing group-label interaction (double-click to edit,
   Enter/blur commits, Escape cancels).

## Non-goals

- Full oEmbed / Instagram API integration (login-gated content stays out of scope).
- Rendering remote images directly by URL (hotlinking) — thumbnails are always
  copied into our own storage so cards don't break when CDN links expire.
- Scraping post captions/comments beyond Open Graph metadata.

## Approaches considered

1. **Client-side fetch + post as upload** — rejected: browser CORS blocks most
   origins, and cookies/credentials handling would be wrong. Server-side fetch
   also lets us guard against private-network (SSRF) targets.
2. **Link-only item rendered via remote `<img>`** — rejected: thumbnails break
   when source CDN URLs expire (Instagram CDN links are short-lived) and leak
   referer data; mood boards must stay intact long-term.
3. **Server-side fetch + store thumbnail/image in MinIO (chosen)** — one new
   endpoint; both branches (image vs page) converge on the existing item
   pipeline. Trades one-time storage cost for durable boards.

## Server

- `POST /api/projects/:id/items/from-url` with `{ url, x, y }`:
  - Guard rail (`src/lib/url-fetch.ts`): only http(s), no credentials in URL,
    hostname must not be localhost/private/loopback (name + DNS-resolved IP
    check), redirects re-validated each hop, response capped at 20 MB, 15 s
    timeout.
  - `image/*` response → reuse the upload pipeline (image-size, object key,
    MinIO put, Item create) as `kind: "image"` with `sourceUrl` provenance.
  - HTML response → parse Open Graph tags (`og:image`, `og:title`,
    `og:site_name`), fetch + store the og:image as the card thumbnail,
    create `kind: "link"`. No `og:image` → 422 with a clear message.
  - Shared creation logic extracted from the upload route into
    `createItemWithObject` (`src/lib/items.ts`); upload route refactored onto it.
- `Item` model gains: `kind: "image" | "link"` (default `image`),
  `sourceUrl`, `title`, `siteName`, `label` (default `""`). Existing docs
  keep working via defaults; `objectKey` holds the image or the stored
  thumbnail, so the storage proxy route stays unchanged.
- `PATCH /api/items/:id` accepts `label` (trimmed, max 120, via existing
  `cleanLabel`). Sync propagates everything through `itemJSON` unchanged.

## Client

- Toolbar "Add link" form (input + button) next to "+ Group"; drop handler now
  also accepts a URL (dragging an image/link from a browser onto the canvas
  imports it at the drop point).
- `BoardItem` renders by kind:
  - image: as today, plus a caption strip below the box for the label
    (visible when labeled, hovered, or selected).
  - link: card = stored thumbnail (cover) + footer (label, else title;
    site name; "Open ↗" anchor that stops propagation so it doesn't start a drag).
- Label editing reuses the group label edit state machine, extended with a
  `target: "group" | "item"` discriminator; double-click on item/card starts it.

## Tests

- `tests/url-fetch.test.ts`: URL/host guards, OG extraction (attribute order,
  entities, relative URLs).
- `tests/import-from-url.test.ts`: route behavior for image link, OG page,
  page without og:image, and private-URL rejection (fetch + DNS mocked,
  Mongo real, MinIO mocked — same harness as `items-upload.test.ts`).
- `tests/item-label.test.ts`: PATCH label persistence + JSON shape.
