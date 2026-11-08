/**
 * Instagram link-import support.
 *
 * Instagram stopped serving og:image (and embed HTML) to anonymous clients,
 * so plain OG scraping can't extract previews from instagram.com anymore.
 * When APIFY_TOKEN is configured, post URLs are resolved through the Apify
 * "apify/instagram-post-scraper" actor (run-sync REST endpoint, plain fetch —
 * no SDK) and normalized here. Any failure resolves to null so callers can
 * fall back to the regular OG path.
 */
const APIFY_SYNC_URL =
  "https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items";
const APIFY_TIMEOUT_MS = 90_000;
const APIFY_RUN_TIMEOUT_S = 90;

// Pure helper lives in its own module so client components can share it.
export { isInstagramPostUrl } from "./instagram-url";

/** Optional APIFY_TOKEN; null when Instagram imports are not enabled. */
export function apifyToken(): string | null {
  const token = process.env.APIFY_TOKEN;
  return token && token.trim().length > 0 ? token.trim() : null;
}

export type InstagramPost = {
  /** Post image (cover for videos) — caller must fetch + re-host it; CDN URLs expire. */
  imageUrl: URL;
  caption: string | null;
  author: string | null;
  /** Canonical post URL (provenance for the card link). */
  postUrl: string;
};

type ApifyPostItem = {
  url?: unknown;
  shortCode?: unknown;
  inputUrl?: unknown;
  caption?: unknown;
  ownerUsername?: unknown;
  displayUrl?: unknown;
};

/**
 * Resolve an Instagram post URL via the Apify actor. Resolves to null on any
 * failure (bad token, private post, missing media, timeout) — the route then
 * falls back to regular OG scraping.
 */
export async function fetchInstagramPost(
  postUrl: URL,
  token: string
): Promise<InstagramPost | null> {
  try {
    const res = await fetch(
      `${APIFY_SYNC_URL}?token=${encodeURIComponent(token)}&timeout=${APIFY_RUN_TIMEOUT_S}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: [postUrl.toString()],
          resultsLimit: 1,
          dataDetailLevel: "basicData",
          includeMusicData: false,
        }),
        signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
      }
    );
    if (!res.ok) return null;

    const items = (await res.json()) as ApifyPostItem[];
    if (!Array.isArray(items)) return null;

    // Private/deleted posts come back as items without media — require displayUrl.
    const code = postUrl.pathname.split("/")[2];
    const item =
      items.find(
        (i) =>
          typeof i.displayUrl === "string" &&
          i.displayUrl.length > 0 &&
          ((typeof i.url === "string" && i.url.includes(`/${code}`)) ||
            (typeof i.shortCode === "string" && i.shortCode === code))
      ) ?? items.find((i) => typeof i.displayUrl === "string" && i.displayUrl.length > 0);
    if (!item) return null;

    let imageUrl: URL;
    try {
      imageUrl = new URL(item.displayUrl as string);
    } catch {
      return null;
    }
    if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") return null;

    const caption =
      typeof item.caption === "string" && item.caption.trim() ? item.caption : null;
    const author =
      typeof item.ownerUsername === "string" && item.ownerUsername.trim()
        ? item.ownerUsername
        : null;
    const postUrlCanonical =
      typeof item.url === "string" && item.url ? item.url : postUrl.toString();

    return { imageUrl, caption, author, postUrl: postUrlCanonical };
  } catch {
    return null;
  }
}
