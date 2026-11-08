/**
 * TikTok link-import helper.
 *
 * TikTok's Open Graph card (`og:image`) is a 1200x630 share image: the video
 * is letterboxed against a blurred, upscaled copy of itself. The regular video
 * page preloads the real cover (`data-source="ssr-cover-preload"`), which has
 * the video's native aspect ratio — using it gives a card with no blurred
 * bars, no extra cropping step.
 */

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/**
 * Extract the preloaded origin cover from a TikTok video page, or null when
 * the page doesn't expose one (private/deleted video, changed markup).
 */
export function extractTikTokCover(html: string, baseUrl: string): URL | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of links) {
    const source = attr(tag, "data-source");
    if (source?.toLowerCase() !== "ssr-cover-preload") continue;
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // Malformed href — keep looking at other preloads.
    }
  }
  return null;
}
