/**
 * Server-side fetching of external URLs for link imports.
 *
 * Guard rails:
 * - Only http(s), no embedded credentials.
 * - Hostnames must not resolve to private/loopback/link-local addresses
 *   (SSRF protection); redirects are re-validated on every hop.
 * - Response bodies are capped and the fetch times out.
 */
import { lookup } from "node:dns/promises";

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

/** Browser-like UA so pages that gate content on bots still serve OG tags. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** True for IPv4/IPv6 literals that must never be fetched (SSRF). */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true; // malformed literal — reject
    const [p1, p2] = o;
    if (p1 === 0 || p1 === 10 || p1 === 127) return true;
    if (p1 === 169 && p2 === 254) return true; // link-local
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return true;
    if (p1 === 192 && p2 === 168) return true;
    if (p1 === 100 && p2 >= 64 && p2 <= 127) return true; // CGNAT
    return false;
  }
  if (a.includes(":")) {
    if (a === "::" || a === "::1") return true; // unspecified / loopback
    if (/^f[cd]/.test(a)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local
    const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

/** True for hostnames that must never be fetched (names or IP literals). */
export function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  return isPrivateAddress(h);
}

/**
 * Parse a user-provided link into a fetchable URL, or null when the link is
 * not a plain public http(s) URL.
 */
export function parsePublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!isPrivateHostname(u.hostname)) return u;
  return null;
}

/** Resolve the hostname and reject when every/any address is private. */
async function assertResolvablePublicHost(u: URL): Promise<void> {
  const addrs = await lookup(u.hostname, { all: true });
  if (addrs.length === 0) throw new Error("unresolved-host");
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error("blocked-host");
  }
}

export type RemoteFetch = {
  buffer: Buffer;
  contentType: string;
  /** URL after following redirects — provenance for the item record. */
  finalUrl: string;
};

/**
 * Fetch a public URL, following redirects (each hop re-validated), with a
 * hard cap on the response size. Throws Error with a short code-ish message;
 * routes map those to user-facing errors.
 */
export async function fetchRemote(rawUrl: string, maxBytes: number): Promise<RemoteFetch> {
  let current = parsePublicHttpUrl(rawUrl);
  if (!current) throw new Error("bad-url");

  for (let hops = 0; ; hops++) {
    await assertResolvablePublicHost(current);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
      });
    } catch (e) {
      throw new Error(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "fetch-failed");
    }

    if (res.status >= 300 && res.status < 400) {
      if (hops >= MAX_REDIRECTS) throw new Error("too-many-redirects");
      const location = res.headers.get("location");
      if (!location) throw new Error("fetch-failed");
      const next = parsePublicHttpUrl(new URL(location, current).toString());
      if (!next) throw new Error("blocked-host");
      current = next;
      continue;
    }

    if (!res.ok) throw new Error(`http-${res.status}`);

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("too-large");

    const buffer = await readCapped(res.body, maxBytes);
    return { buffer, contentType, finalUrl: current.toString() };
  }
}

async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) throw new Error("empty-body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export type OgMeta = {
  /** Absolute URL of the preview image, or null when the page has none. */
  imageUrl: URL | null;
  title: string | null;
  siteName: string | null;
};

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (_, name) => ENTITY_MAP[name.toLowerCase()] ?? `&${name};`);
}

function metaAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Extract Open Graph preview metadata from an HTML page. */
export function extractOgMeta(html: string, baseUrl: string): OgMeta {
  const og = new Map<string, string>();
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = metaAttr(tag, "property") ?? metaAttr(tag, "name");
    if (!key || !key.toLowerCase().startsWith("og:")) continue;
    const content = metaAttr(tag, "content");
    if (content === null) continue;
    const k = key.toLowerCase();
    if (!og.has(k)) og.set(k, content);
  }

  const rawImage = og.get("og:image") ?? og.get("og:image:secure_url") ?? null;
  let imageUrl: URL | null = null;
  if (rawImage) {
    try {
      const u = new URL(rawImage, baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") imageUrl = u;
    } catch {
      imageUrl = null;
    }
  }

  const title = og.get("og:title")?.trim() || null;
  const siteName = og.get("og:site_name")?.trim() || null;
  return { imageUrl, title, siteName };
}
