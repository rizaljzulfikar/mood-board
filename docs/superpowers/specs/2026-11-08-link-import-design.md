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
  - Platform detection (`src/lib/social-url.ts`): Instagram post/reel/tv,
    TikTok video/photo (incl. `vm.tiktok.com`, `vt.tiktok.com`, `/t/` short
    links) and Pinterest pins (incl. `pin.it`), shared with the client.
  - TikTok serves its Open Graph card only to link-preview crawlers, so those
    pages are fetched with a Facebook crawler UA
    (`PREVIEW_BOT_USER_AGENT`); a generic link that redirects to TikTok is
    retried once with that UA. Pinterest og:image works with the regular
    browser UA; Instagram post URLs are resolved through Apify when
    `APIFY_TOKEN` is set (see `src/lib/instagram.ts`).
  - `image/*` response → reuse the upload pipeline (image-size, object key,
    MinIO put, Item create) as `kind: "image"` with `sourceUrl` provenance.
  - HTML response → parse Open Graph tags (`og:image`, `og:title`,
    `og:site_name`), fetch + store the og:image as the card thumbnail,
    create `kind: "link"`. No `og:image` → 422 with a clear message.
    TikTok titles drop the `TikTok · ` prefix and use the `@handle` from the
    URL as site name; Pinterest cards use `Pinterest` as site name.
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
  imports it at the drop point). The dialog offers "Import from Instagram",
  "TikTok" and "Pinterest" buttons that pre-validate the pasted URL for that
  platform.
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
  page without og:image, private-URL rejection, and TikTok/Pinterest imports
  (fetch + DNS mocked, Mongo real, MinIO mocked — same harness as
  `items-upload.test.ts`).
- `tests/item-label.test.ts`: PATCH label persistence + JSON shape.

## Extension: TikTok covers, image cropping, fixed-size group labels

Added 2026-11-09.

### TikTok auto-crop

TikTok's `og:image` is a 1200x630 share card: the video is letterboxed against
a blurred upscale of itself. The regular video page preloads the real cover
(`<link data-source="ssr-cover-preload">`), which keeps the video's native
aspect ratio (e.g. 540x960). The import route fetches the crawler page for the
OG title and the regular page for that cover, preferring the cover and falling
back to the share card. `src/lib/tiktok.ts` holds the pure extractor;
`tests/tiktok-cover.test.ts` covers it.

### Non-destructive image crop

- `Item.crop = { x, y, w, h }`, fractions of the original image (default full).
  No pixels are rewritten; the stored object stays intact.
- The item box always shows exactly the crop region. `src/lib/crop.ts` maps an
  edge drag to both the crop fractions and the world geometry (x/y/width/
  height), so trimming an edge shrinks/moves the card and dragging outward
  restores hidden content. `tests/crop.test.ts` covers all four edges, the
  minimum-size clamp, and the rendering offsets.
- Link cards crop too: the crop covers the thumbnail area above the fixed
  52px footer, which is never cropped. The bottom handle sits on the footer
  boundary (`bottomInset` in `cropEdgeGeometry`).
- Crop mode is toggled by double-clicking the item's resize handle (the same
  affordance the group box uses for "fit to contents"). It shows four edge
  handles (top, right, bottom, left); dragging one trims that edge. Escape or
  selecting anything else leaves the mode, and the resize handle stays
  double-clickable to exit. Double-clicking the image or caption still edits
  the label.
- `PATCH /api/items/:id` accepts and clamps `crop`; `itemJSON` normalizes it,
  so older documents render as a full crop and sync/undo carry it unchanged.

### Fixed-size group labels

Group labels are inside the zoom-scaled world. `GroupBox` now applies
`transform: scale(1 / zoom) translateY(-8px)` with the label's max width in
world units (`group.width × zoom`), so the label keeps a constant on-screen
font size, a constant gap, and still spans the box at any zoom level. The
label sits outside the box, above its top edge (`bottom: 100%` in CSS).

