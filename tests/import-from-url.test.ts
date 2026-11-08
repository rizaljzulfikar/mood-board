import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DNS: pretend every host resolves to a public address (localhost is still
// rejected earlier, by name). Fetch: queued canned responses per test.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "157.240.1.35", family: 4 }]),
}));
vi.mock("@/lib/minio", () => ({
  putObjectBuffer: vi.fn(async () => {}),
  getObject: vi.fn(),
  ensureBucket: vi.fn(async () => {}),
  getS3Client: vi.fn(),
  bucketName: vi.fn(() => "moodboard"),
}));
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { POST } from "@/app/api/projects/[id]/items/from-url/route";
import { putObjectBuffer } from "@/lib/minio";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function imageResponse(buffer: Buffer, type = "image/png") {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { "content-type": type },
  });
}

let user: { _id: { toString(): string } };
let project: { _id: { toString(): string } };

async function importUrl(url: string, x = 100, y = 200) {
  const req = new Request(`http://localhost/api/projects/${project._id}/items/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, x, y }),
  });
  return POST(req, { params: Promise.resolve({ id: String(project._id) }) });
}

beforeEach(async () => {
  await connectDB();
  const created = await User.create({
    email: `url-${Date.now()}-${Math.random()}@test.local`,
    name: "Linker",
    passwordHash: "x",
  });
  user = created;
  project = await Project.create({ name: "Link import test", owner: created._id, members: [] });
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: String(created._id),
    email: created.email,
    name: created.name,
    role: "user",
    mustChangePassword: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/projects/:id/items/from-url", () => {
  it("imports a direct image link into storage as an image item", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse(PNG_1X1))
    );

    const res = await importUrl("https://pics.example.net/photo.png");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("image");
    expect(item.mime).toBe("image/png");
    expect(item.width).toBe(1);
    expect(item.height).toBe(1);
    expect(item.sourceUrl).toBe("https://pics.example.net/photo.png");
    expect(item.x).toBe(99.5); // centered on the requested point
    expect(item.y).toBe(199.5);
    expect(item.objectKey).toMatch(new RegExp(`^${project._id}/[a-f0-9]+\\.png$`));
    expect(putObjectBuffer).toHaveBeenCalledWith(item.objectKey, PNG_1X1, "image/png");

    const persisted = await Item.findById(item.id);
    expect(persisted?.kind).toBe("image");
    expect(persisted?.sourceUrl).toBe("https://pics.example.net/photo.png");
  });

  it("creates a link card from an OG page and stores its thumbnail", async () => {
    const page = `<html><head>
      <meta property="og:title" content="Golden hour shot">
      <meta property="og:site_name" content="Instagram">
      <meta property="og:image" content="https://cdn.instagram.example/s/photo.jpg">
    </head></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(page))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://www.instagram.com/p/abc123/");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("link");
    expect(item.title).toBe("Golden hour shot");
    expect(item.siteName).toBe("Instagram");
    expect(item.sourceUrl).toBe("https://www.instagram.com/p/abc123/");
    expect(item.label).toBe("");
    // Card height = thumbnail + footer strip; image area keeps the aspect.
    expect(item.width).toBe(1);
    expect(item.height).toBe(1 + 52);
    expect(item.objectKey).toMatch(/\.jpg$/);
    expect(putObjectBuffer).toHaveBeenCalledWith(item.objectKey, PNG_1X1, "image/jpeg");
    // Second fetch hit the resolved og:image URL.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://cdn.instagram.example/s/photo.jpg");
  });

  it("rejects a page without og:image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("<html><head><title>hi</title></head></html>")));

    const res = await importUrl("https://example.net/no-image");
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/no preview image/i);
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("rejects private/loopback URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://localhost:9100/minio",
      "http://127.0.0.1/x.png",
      "http://169.254.169.254/meta",
      "file:///etc/passwd",
      "not a url",
    ]) {
      const res = await importUrl(url);
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("maps fetch failures to a 502 with a readable message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    const res = await importUrl("https://example.net/missing");
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error?: string };
    expect(typeof data.error).toBe("string");
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("rejects non-image non-html content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } })
      )
    );

    const res = await importUrl("https://example.net/blob.bin");
    expect(res.status).toBe(415);
  });

  it("imports Instagram posts via Apify when APIFY_TOKEN is set", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test_token");
    const apifyItem = {
      url: "https://www.instagram.com/p/DfFb49L/",
      shortCode: "DfFb49L",
      type: "Image",
      caption: "Ceramic mug photo",
      ownerUsername: "natgeo",
      displayUrl: "https://scontent.cdninstagram.test/v/t51/DfFb49L.jpg",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([apifyItem]), { status: 200 }))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://www.instagram.com/p/DfFb49L/");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("link");
    expect(item.title).toBe("Ceramic mug photo");
    expect(item.siteName).toBe("@natgeo");
    expect(item.sourceUrl).toBe("https://www.instagram.com/p/DfFb49L/");
    expect(putObjectBuffer).toHaveBeenCalledWith(item.objectKey, PNG_1X1, "image/jpeg");

    // Only the Apify run + the CDN image are fetched — never instagram.com itself.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.apify.com/v2/acts/apify~instagram-post-scraper");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://scontent.cdninstagram.test/v/t51/DfFb49L.jpg");
  });

  it("suggests APIFY_TOKEN when an Instagram link has no preview and no token is set", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<html><head><title>Instagram</title></head></html>"))
    );

    const res = await importUrl("https://www.instagram.com/p/DfFb49L/");
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/APIFY_TOKEN/);
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("falls back to OG scraping without the token hint when Apify fails", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test_token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(htmlResponse("<html><head><title>Instagram</title></head></html>"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://www.instagram.com/p/DfFb49L/");
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/no preview image/i);
    expect(data.error).not.toMatch(/APIFY_TOKEN/);
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("imports a TikTok video using the origin cover instead of the share card", async () => {
    const crawlerPage = `<html><head>
      <title>TikTok · Josh Renaud</title>
      <meta property="og:site_name" content="TikTok"/>
      <meta property="og:image" content="https://p16-common-sign.tiktokcdn.test/share-card.jpg"/>
      <meta property="og:title" content="TikTok · Josh Renaud"/>
    </head></html>`;
    const regularPage = `<html><head>
      <link rel="preload" as="image" fetchpriority="high"
        href="https://p16-common-sign.tiktokcdn.test/origin-cover.jpg?x=1&amp;y=2"
        data-source="ssr-cover-preload">
    </head></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(crawlerPage))
      .mockResolvedValueOnce(htmlResponse(regularPage))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://www.tiktok.com/@josheramics/video/6718335390845095173");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("link");
    // "TikTok · " prefix is dropped, creator handle becomes the site name.
    expect(item.title).toBe("Josh Renaud");
    expect(item.siteName).toBe("@josheramics");
    expect(item.sourceUrl).toBe("https://www.tiktok.com/@josheramics/video/6718335390845095173");

    // The native origin cover wins over the 1200x630 letterboxed share card.
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      "https://p16-common-sign.tiktokcdn.test/origin-cover.jpg?x=1&y=2"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The crawler fetch still uses the preview-bot UA for the OG metadata.
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["user-agent"]).toMatch(
      /facebookexternalhit/
    );
    // The cover page is fetched like a normal browser.
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)["user-agent"]).toMatch(/Chrome/);
  });

  it("falls back to the TikTok share card when no origin cover is preloaded", async () => {
    const crawlerPage = `<html><head>
      <meta property="og:site_name" content="TikTok"/>
      <meta property="og:image" content="https://p16-common-sign.tiktokcdn.test/share-card.jpg"/>
      <meta property="og:title" content="TikTok · Josh Renaud"/>
    </head></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(crawlerPage))
      .mockResolvedValueOnce(htmlResponse("<html></html>"))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://www.tiktok.com/@josheramics/video/6718335390845095173");
    expect(res.status).toBe(201);
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      "https://p16-common-sign.tiktokcdn.test/share-card.jpg"
    );
  });

  it("follows a TikTok short link and keeps the crawler UA for metadata", async () => {
    const crawlerPage = `<html><head>
      <meta property="og:site_name" content="TikTok"/>
      <meta property="og:image" content="https://p16-common-sign.tiktokcdn.test/share-card.jpg"/>
      <meta property="og:title" content="TikTok · Short link creator"/>
    </head></html>`;
    const regularPage = `<link data-source="ssr-cover-preload" href="https://p16-common-sign.tiktokcdn.test/short.jpg">`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://www.tiktok.com/@shortie/video/7000000000000000000" },
        })
      )
      .mockResolvedValueOnce(htmlResponse(crawlerPage))
      .mockResolvedValueOnce(htmlResponse(regularPage))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://vm.tiktok.com/ZMre7abcd/");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("link");
    expect(item.sourceUrl).toBe("https://www.tiktok.com/@shortie/video/7000000000000000000");
    expect(item.siteName).toBe("@shortie");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Redirect hop + crawler page both use the preview-bot UA.
    for (const call of fetchMock.mock.calls.slice(0, 2)) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>)["user-agent"]).toMatch(
        /facebookexternalhit/
      );
    }
  });

  it("reports a TikTok link without a preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<html><head><title>TikTok</title></head></html>"))
    );

    const res = await importUrl("https://www.tiktok.com/@scout2015/video/6718335390845095173");
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/TikTok didn't return a preview/i);
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("creates a link card from a Pinterest pin (content-first meta tags)", async () => {
    const page = `<html><head>
      <meta content="Pinterest" property="og:site_name"/>
      <meta content="https://i.pinimg.test/736x/ff/b1/10/vase.jpg" name="og:image" property="og:image"/>
      <meta content="P Shape Ceramic Vase" name="og:title" property="og:title"/>
    </head></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(page))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl(
      "https://www.pinterest.com/pin/p-shape-ceramic-vase-personalized-home-decor--1013028509922229190/"
    );
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("link");
    expect(item.title).toBe("P Shape Ceramic Vase");
    expect(item.siteName).toBe("Pinterest");
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "https://i.pinimg.test/736x/ff/b1/10/vase.jpg"
    );

    // Pinterest serves its preview to a normal browser UA.
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["user-agent"]).toMatch(/Chrome/);
  });

  it("reports a Pinterest pin without a preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<html><head><title>Pinterest</title></head></html>"))
    );

    const res = await importUrl("https://pin.it/4Zb6cde");
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/Pinterest didn't return a preview/i);
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });
});
