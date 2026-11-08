import { describe, it, expect } from "vitest";

import { extractTikTokCover } from "@/lib/tiktok";

const PAGE = "https://www.tiktok.com/@josheramics/video/1234567890";

describe("extractTikTokCover", () => {
  it("finds the ssr-cover-preload link", () => {
    const html = `<html><head>
      <link rel="preload" as="image" fetchpriority="high"
        href="https://p16-common-sign.tiktokcdn.com/tos-maliva-p-0068/abc~tplv-tiktokx-origin.image?dr=1&amp;x-expires=2&amp;x-signature=abc%2Fdef%3D"
        data-source="ssr-cover-preload">
    </head></html>`;

    const cover = extractTikTokCover(html, PAGE);
    expect(cover?.toString()).toBe(
      "https://p16-common-sign.tiktokcdn.com/tos-maliva-p-0068/abc~tplv-tiktokx-origin.image?dr=1&x-expires=2&x-signature=abc%2Fdef%3D"
    );
  });

  it("handles reversed attribute order and single quotes", () => {
    const html = `<link data-source='ssr-cover-preload' href='https://cdn.example/cover.jpg'>`;
    expect(extractTikTokCover(html, PAGE)?.toString()).toBe("https://cdn.example/cover.jpg");
  });

  it("resolves relative covers", () => {
    const html = `<link data-source="ssr-cover-preload" href="/cover.jpg">`;
    expect(extractTikTokCover(html, PAGE)?.toString()).toBe("https://www.tiktok.com/cover.jpg");
  });

  it("returns null when the page has no origin cover", () => {
    const html = `<html><head><meta property="og:image" content="https://cdn.example/share-card.jpg"></head></html>`;
    expect(extractTikTokCover(html, PAGE)).toBeNull();
  });

  it("ignores non-http covers", () => {
    const html = `<link data-source="ssr-cover-preload" href="javascript:alert(1)">`;
    expect(extractTikTokCover(html, PAGE)).toBeNull();
  });
});
