import { describe, it, expect } from "vitest";
import {
  extractOgMeta,
  isPrivateAddress,
  isPrivateHostname,
  parsePublicHttpUrl,
} from "@/lib/url-fetch";

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["192.168.0.15", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["100.128.0.1", false],
    ["0.0.0.0", true],
    ["8.8.8.8", false],
    ["157.240.1.35", false],
    ["999.1.1.1", true], // malformed literal is rejected
    ["::1", true],
    ["::", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["::ffff:127.0.0.1", true],
    ["2607:f8b0:4004:800::200e", false],
  ])("%s → %s", (addr, expected) => {
    expect(isPrivateAddress(addr)).toBe(expected);
  });
});

describe("isPrivateHostname", () => {
  it.each([
    ["localhost", true],
    ["sub.localhost", true],
    ["foo.local", true],
    ["box.internal", true],
    ["box.lan", true],
    ["instagram.com", false],
    ["www.instagram.com.", false],
  ])("%s → %s", (host, expected) => {
    expect(isPrivateHostname(host)).toBe(expected);
  });
});

describe("parsePublicHttpUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(parsePublicHttpUrl("https://www.instagram.com/p/abc123/")?.hostname).toBe(
      "www.instagram.com"
    );
    expect(parsePublicHttpUrl("http://example.com/img.png")?.protocol).toBe("http:");
  });

  it("rejects non-http schemes", () => {
    expect(parsePublicHttpUrl("ftp://example.com/x")).toBeNull();
    expect(parsePublicHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parsePublicHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects credentials in the URL", () => {
    expect(parsePublicHttpUrl("https://user:pass@example.com/")).toBeNull();
  });

  it("rejects private and loopback hosts without DNS", () => {
    expect(parsePublicHttpUrl("http://localhost:3000/x")).toBeNull();
    expect(parsePublicHttpUrl("http://127.0.0.1/x")).toBeNull();
    expect(parsePublicHttpUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(parsePublicHttpUrl("http://dev.box.internal/x")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parsePublicHttpUrl("not a url")).toBeNull();
    expect(parsePublicHttpUrl("")).toBeNull();
  });
});

describe("extractOgMeta", () => {
  const BASE = "https://www.instagram.com/p/abc123/";

  it("reads og tags regardless of attribute order", () => {
    const html = `<html><head>
      <meta content="My IG Post" property="og:title">
      <meta property="og:site_name" content="Instagram">
      <meta name="og:image" content="https://cdn.example.net/thumb.jpg">
    </head></html>`;
    const meta = extractOgMeta(html, BASE);
    expect(meta.title).toBe("My IG Post");
    expect(meta.siteName).toBe("Instagram");
    expect(meta.imageUrl?.toString()).toBe("https://cdn.example.net/thumb.jpg");
  });

  it("keeps the first tag when a key repeats", () => {
    const html = `<meta property="og:image" content="https://a.example/first.jpg">
      <meta property="og:image" content="https://a.example/second.jpg">`;
    expect(extractOgMeta(html, BASE).imageUrl?.toString()).toBe("https://a.example/first.jpg");
  });

  it("decodes entities and resolves relative image URLs", () => {
    const html = `<meta property="og:title" content="Fish &amp; Chips &#8212; It&#39;s fine">
      <meta property="og:image" content="/img/thumb.png?v=2&amp;h=1">`;
    const meta = extractOgMeta(html, BASE);
    expect(meta.title).toBe("Fish & Chips — It's fine");
    expect(meta.imageUrl?.toString()).toBe("https://www.instagram.com/img/thumb.png?v=2&h=1");
  });

  it("returns null image and title when tags are missing", () => {
    const meta = extractOgMeta("<html><head><title>x</title></head></html>", BASE);
    expect(meta.imageUrl).toBeNull();
    expect(meta.title).toBeNull();
    expect(meta.siteName).toBeNull();
  });

  it("ignores non-http image URLs", () => {
    const html = `<meta property="og:image" content="data:text/html;base64,PHNjcmlwdD4=">`;
    expect(extractOgMeta(html, BASE).imageUrl).toBeNull();
  });
});
