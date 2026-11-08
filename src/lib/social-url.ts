/**
 * Pure social-platform URL helpers shared by the server import route and the
 * client action bar. Kept free of env/fetch dependencies so it can be bundled
 * client-side.
 */

/** Canonical hostname, lowercase and without a trailing dot. */
function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/\.$/, "");
}

/** True for an apex domain and its subdomains. */
function isHost(hostname: string, apex: string): boolean {
  return hostname === apex || hostname.endsWith(`.${apex}`);
}

/** True for Pinterest's domains and subdomains (pinterest.com, pinterest.co.uk, …). */
function isPinterestHost(hostname: string): boolean {
  return (
    hostname === "pin.it" ||
    /^(?:[a-z0-9-]+\.)*pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(hostname)
  );
}

export type SocialPlatform = "instagram" | "tiktok" | "pinterest";

/** True for instagram.com post/reel/tv links (the only URLs the actor path handles). */
export function isInstagramPostUrl(u: URL): boolean {
  if (!isHost(host(u), "instagram.com")) return false;
  return /^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/.test(u.pathname);
}

/** True for TikTok video/photo links, including the vm./vt. and /t/ short links. */
export function isTikTokPostUrl(u: URL): boolean {
  const h = host(u);
  if (h === "vm.tiktok.com" || h === "vt.tiktok.com") return true;
  if (!isHost(h, "tiktok.com")) return false;
  return /^\/@[^/]+\/(video|photo)\/\d+/.test(u.pathname) || /^\/t\/[A-Za-z0-9]+/.test(u.pathname);
}

/** True for Pinterest pin links, including pin.it short links. */
export function isPinterestPinUrl(u: URL): boolean {
  if (!isPinterestHost(host(u))) return false;
  if (host(u) === "pin.it") return true;
  return /^\/pin\/[^/]+/.test(u.pathname);
}

/** Platform whose dedicated importer should handle this URL, if any. */
export function socialPlatform(u: URL): SocialPlatform | null {
  if (isInstagramPostUrl(u)) return "instagram";
  if (isTikTokPostUrl(u)) return "tiktok";
  if (isPinterestPinUrl(u)) return "pinterest";
  return null;
}

/** @handle from a TikTok video URL (…/@scout2015/video/123), or null. */
export function tiktokUsername(u: URL): string | null {
  const m = u.pathname.match(/^\/@([^/]+)\/(?:video|photo)\/\d+/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
