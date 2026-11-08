import { describe, it, expect } from "vitest";

import {
  isInstagramPostUrl,
  isPinterestPinUrl,
  isTikTokPostUrl,
  socialPlatform,
  tiktokUsername,
} from "@/lib/social-url";

function check(fn: (u: URL) => boolean, cases: Array<[string, boolean]>) {
  for (const [url, expected] of cases) {
    it(`${expected ? "accepts" : "rejects"} ${url}`, () => {
      expect(fn(new URL(url))).toBe(expected);
    });
  }
}

describe("isInstagramPostUrl", () => {
  check(isInstagramPostUrl, [
    ["https://www.instagram.com/p/DfFb49L/", true],
    ["https://www.instagram.com/reel/DaV7mnAGq7/", true],
    ["https://www.instagram.com/reels/DRaV7mnAGq7/", true],
    ["https://www.instagram.com/tv/DLNsnpUTdVS/", true],
    ["https://www.instagram.com/natgeo/", false],
    ["https://example.com/p/abc123/", false],
  ]);
});

describe("isTikTokPostUrl", () => {
  check(isTikTokPostUrl, [
    ["https://www.tiktok.com/@scout2015/video/6718335390845095173", true],
    ["https://tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1", true],
    ["https://m.tiktok.com/@scout2015/photo/7312345678901234567", true],
    ["https://vm.tiktok.com/ZMre7abcd/", true],
    ["https://vt.tiktok.com/ZSre7abcd/", true],
    ["https://www.tiktok.com/t/ZTRre7abcd/", true],
    ["https://www.tiktok.com/@scout2015", false], // profile, not a post
    ["https://www.tiktok.com/explore", false],
    ["https://example.com/@scout2015/video/123", false],
    ["https://tiktoknonsense.com/@scout2015/video/123", false],
  ]);
});

describe("isPinterestPinUrl", () => {
  check(isPinterestPinUrl, [
    ["https://www.pinterest.com/pin/1013028509922229190/", true],
    ["https://pinterest.co.uk/pin/1013028509922229190/", true],
    [
      "https://www.pinterest.com/pin/p-shape-ceramic-vase-personalized-home-decor--1013028509922229190/",
      true,
    ],
    ["https://pin.it/4Zb6cde", true],
    ["https://www.pinterest.com/decor8/mood-boards/", false], // board, not a pin
    ["https://www.pinterest.com/pinterest/", false], // profile
    ["https://example.com/pin/123/", false],
  ]);
});

describe("socialPlatform", () => {
  it("routes each supported link to its platform", () => {
    expect(socialPlatform(new URL("https://www.instagram.com/p/abc123/"))).toBe("instagram");
    expect(socialPlatform(new URL("https://vm.tiktok.com/ZMre7abcd/"))).toBe("tiktok");
    expect(socialPlatform(new URL("https://pin.it/4Zb6cde"))).toBe("pinterest");
    expect(socialPlatform(new URL("https://example.com/article"))).toBeNull();
  });
});

describe("tiktokUsername", () => {
  it("extracts the creator handle from a video or photo link", () => {
    expect(
      tiktokUsername(new URL("https://www.tiktok.com/@scout2015/video/6718335390845095173"))
    ).toBe("scout2015");
    expect(
      tiktokUsername(new URL("https://www.tiktok.com/@scout2015/photo/6718335390845095173"))
    ).toBe("scout2015");
  });

  it("returns null for short links and profiles", () => {
    expect(tiktokUsername(new URL("https://vm.tiktok.com/ZMre7abcd/"))).toBeNull();
    expect(tiktokUsername(new URL("https://www.tiktok.com/@scout2015"))).toBeNull();
  });
});
