import { describe, it, expect, vi, afterEach } from "vitest";

import { isInstagramPostUrl, fetchInstagramPost } from "@/lib/instagram";

function post(code: string, extra: Record<string, unknown> = {}) {
  return {
    inputUrl: `https://www.instagram.com/p/${code}/`,
    shortCode: code,
    url: `https://www.instagram.com/p/${code}/`,
    type: "Image",
    caption: `Caption of ${code}`,
    ownerUsername: "natgeo",
    displayUrl: `https://scontent.cdninstagram.test/v/t51/${code}.jpg`,
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isInstagramPostUrl", () => {
  const cases: Array<[string, boolean]> = [
    ["https://www.instagram.com/p/DfFb49L/", true],
    ["https://instagram.com/p/DfFb49L/", true],
    ["https://www.instagram.com/p/DfFb49L?utm_source=share", true],
    ["https://www.instagram.com/reel/DaV7mnAGq7/", true],
    ["https://www.instagram.com/reels/DRaV7mnAGq7/", true],
    ["https://www.instagram.com/tv/DLNsnpUTdVS/", true],
    ["https://www.instagram.com/natgeo/", false], // profile, not a post
    ["https://www.instagram.com/explore/tags/ceramics/", false],
    ["https://example.com/p/abc123/", false],
    ["https://instagramnonsense.com/p/abc/", false],
  ];

  for (const [url, expected] of cases) {
    it(`${expected ? "accepts" : "rejects"} ${url}`, () => {
      expect(isInstagramPostUrl(new URL(url))).toBe(expected);
    });
  }
});

describe("fetchInstagramPost", () => {
  it("normalizes the matching dataset item into imageUrl/caption/author", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      new Response(JSON.stringify([post("DfFb49L")]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchInstagramPost(
      new URL("https://www.instagram.com/p/DfFb49L/"),
      "apify_test_token"
    );

    expect(result).not.toBeNull();
    expect(result!.imageUrl.toString()).toBe(
      "https://scontent.cdninstagram.test/v/t51/DfFb49L.jpg"
    );
    expect(result!.caption).toBe("Caption of DfFb49L");
    expect(result!.author).toBe("natgeo");
    expect(result!.postUrl).toBe("https://www.instagram.com/p/DfFb49L/");

    // Runs the actor synchronously with the post URL and cheapest detail level.
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain(
      "https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items"
    );
    expect(String(calledUrl)).toContain("token=apify_test_token");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.username).toEqual(["https://www.instagram.com/p/DfFb49L/"]);
    expect(body.dataDetailLevel).toBe("basicData");
    expect(body.includeMusicData).toBe(false);
  });

  it("prefers the dataset item whose url matches the requested post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([post("OTHER1", { shortCode: "OTHER1" }), post("DfFb49L")]), {
          status: 200,
        })
      )
    );

    const result = await fetchInstagramPost(
      new URL("https://www.instagram.com/p/DfFb49L/"),
      "tok"
    );
    expect(result!.postUrl).toBe("https://www.instagram.com/p/DfFb49L/");
    expect(result!.caption).toBe("Caption of DfFb49L");
  });

  it("returns null when the actor returns no usable item (e.g. private post)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: "123" }]), { status: 200 }))
    );

    const result = await fetchInstagramPost(
      new URL("https://www.instagram.com/p/DfFb49L/"),
      "tok"
    );
    expect(result).toBeNull();
  });

  it("returns null on API failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));

    const result = await fetchInstagramPost(
      new URL("https://www.instagram.com/p/DfFb49L/"),
      "bad-token"
    );
    expect(result).toBeNull();
  });

  it("returns null on malformed response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not json</html>", { status: 200 })));

    const result = await fetchInstagramPost(
      new URL("https://www.instagram.com/p/DfFb49L/"),
      "tok"
    );
    expect(result).toBeNull();
  });

  it("returns null when the fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

    const result = await fetchInstagramPost(
      new URL("https://www.instagram.com/p/DfFb49L/"),
      "tok"
    );
    expect(result).toBeNull();
  });
});
