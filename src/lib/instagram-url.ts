/**
 * Pure Instagram URL helpers shared by the server import route and the client
 * action bar. Kept free of env/fetch dependencies so it can be bundled
 * client-side.
 */

/** True for instagram.com post/reel/tv links (the only URLs the actor path handles). */
export function isInstagramPostUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return false;
  return /^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/.test(u.pathname);
}
