import { imageSize } from "image-size";
import { apiError, json, requireMember } from "@/lib/api";
import { createItemWithObject, extFromMime, itemJSON, MAX_UPLOAD_BYTES, ObjectStoreError } from "@/lib/items";
import { LINK_FOOTER_HEIGHT } from "@/lib/crop";
import { apifyToken, fetchInstagramPost, isInstagramPostUrl } from "@/lib/instagram";
import { broadcastUpsert } from "@/lib/realtime-publish";
import { socialPlatform, tiktokUsername, type SocialPlatform } from "@/lib/social-url";
import { extractTikTokCover } from "@/lib/tiktok";
import {
  extractOgMeta,
  fetchRemote,
  parsePublicHttpUrl,
  PREVIEW_BOT_USER_AGENT,
  type OgMeta,
} from "@/lib/url-fetch";

export const runtime = "nodejs";

function userMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  switch (msg) {
    case "bad-url":
    case "blocked-host":
      return "Links to private or internal addresses are not allowed";
    case "unresolved-host":
      return "That host could not be resolved";
    case "timeout":
      return "That link took too long to respond";
    case "too-large":
      return "That file is larger than 20 MB";
    case "too-many-redirects":
      return "That link redirected too many times";
    case "http-401":
    case "http-403":
      return "That page requires login, so its preview can't be fetched";
    default:
      if (msg.startsWith("http-")) return "That link could not be fetched";
      return "Could not fetch that link, please try again";
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);

    const body = (await req.json().catch(() => ({}))) as { url?: unknown; x?: unknown; y?: unknown };
    const rawUrl = typeof body.url === "string" ? body.url : "";
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const x = num(body.x);
    const y = num(body.y);

    const pageUrl = parsePublicHttpUrl(rawUrl);
    if (!pageUrl) return json({ error: "That doesn't look like a valid http(s) link" }, 400);

    const platform = socialPlatform(pageUrl);

    // Instagram serves no og:image to anonymous clients, so OG scraping can't
    // extract previews from post links. Resolve them via the Apify actor when
    // configured; on any Apify failure fall through to the regular OG path.
    const apify = apifyToken();
    if (apify && platform === "instagram") {
      const post = await fetchInstagramPost(pageUrl, apify);
      if (post) {
        let thumb: Awaited<ReturnType<typeof fetchRemote>>;
        try {
          thumb = await fetchRemote(post.imageUrl.toString(), MAX_UPLOAD_BYTES);
        } catch (e) {
          return json({ error: userMessage(e) }, 502);
        }
        if (!thumb.contentType.startsWith("image/")) {
          return json({ error: "The page's preview image could not be loaded" }, 422);
        }
        return importImage({
          projectId: String(project._id),
          userId: user.id,
          url: thumb.finalUrl,
          buffer: thumb.buffer,
          contentType: thumb.contentType,
          x,
          y,
          kind: "link",
          sourceUrl: post.postUrl,
          title: post.caption?.slice(0, 300) || null,
          siteName: post.author ? `@${post.author}` : "Instagram",
          errorStatus: 422,
        });
      }
    }

    let page: Awaited<ReturnType<typeof fetchRemote>>;
    try {
      // TikTok only renders its Open Graph card for link-preview crawlers.
      page = await fetchRemote(pageUrl.toString(), MAX_UPLOAD_BYTES, {
        userAgent: platform === "tiktok" ? PREVIEW_BOT_USER_AGENT : undefined,
      });
    } catch (e) {
      return json({ error: userMessage(e) }, 502);
    }

    const isImage = page.contentType.startsWith("image/");
    const looksHtml =
      page.contentType.includes("html") ||
      page.contentType === "" ||
      page.buffer.subarray(0, 512).toString("utf8").trimStart().startsWith("<");

    if (!isImage && !looksHtml) {
      return json({ error: "That link doesn't point to an image or a page" }, 415);
    }

    // Direct image link: import it into storage as a regular image item.
    if (isImage) {
      return importImage({
        projectId: String(project._id),
        userId: user.id,
        url: page.finalUrl,
        sourceUrl: page.finalUrl,
        buffer: page.buffer,
        contentType: page.contentType,
        x,
        y,
        errorStatus: 415,
      });
    }

    // Page link: extract Open Graph preview and store its image as the thumbnail.
    const finalUrl = new URL(page.finalUrl);
    const finalPlatform = socialPlatform(finalUrl) ?? platform;
    let meta = extractOgMeta(page.buffer.toString("utf8"), page.finalUrl);

    // A generic link that redirects to TikTok (e.g. a shared /t/ code reached
    // from another host) needs a second, crawler-UA fetch: the browser-UA
    // response carries no preview tags.
    if (!meta.imageUrl && finalPlatform === "tiktok" && platform !== "tiktok") {
      try {
        page = await fetchRemote(page.finalUrl, MAX_UPLOAD_BYTES, {
          userAgent: PREVIEW_BOT_USER_AGENT,
        });
        meta = extractOgMeta(page.buffer.toString("utf8"), page.finalUrl);
      } catch {
        // Keep the original page/meta and report the missing preview below.
      }
    }

    // TikTok's share card letterboxes the video against a blurred backdrop.
    // Prefer the origin cover that the regular video page preloads: it has the
    // video's own aspect ratio, so the card is auto-cropped to the content.
    if (finalPlatform === "tiktok") {
      try {
        const regular = await fetchRemote(page.finalUrl, MAX_UPLOAD_BYTES);
        const cover = extractTikTokCover(
          regular.buffer.toString("utf8"),
          regular.finalUrl
        );
        if (cover) meta = { ...meta, imageUrl: cover };
      } catch {
        // Fall back to the OG share card.
      }
    }

    if (!meta.imageUrl) {
      if (isInstagramPostUrl(pageUrl) && !apifyToken()) {
        return json(
          {
            error:
              "Instagram doesn't expose previews for this link — set APIFY_TOKEN to enable Instagram imports",
          },
          422
        );
      }
      if (finalPlatform === "tiktok") {
        return json(
          { error: "TikTok didn't return a preview for that link — it may be private or unavailable" },
          422
        );
      }
      if (finalPlatform === "pinterest") {
        return json({ error: "Pinterest didn't return a preview for that pin" }, 422);
      }
      return json({ error: "No preview image found on that page" }, 422);
    }

    let thumb: Awaited<ReturnType<typeof fetchRemote>>;
    try {
      thumb = await fetchRemote(meta.imageUrl.toString(), MAX_UPLOAD_BYTES);
    } catch (e) {
      return json({ error: userMessage(e) }, 502);
    }
    if (!thumb.contentType.startsWith("image/")) {
      return json({ error: "The page's preview image could not be loaded" }, 422);
    }

    const card = cardMeta(finalPlatform, page.finalUrl, meta);
    return importImage({
      projectId: String(project._id),
      userId: user.id,
      url: thumb.finalUrl,
      buffer: thumb.buffer,
      contentType: thumb.contentType,
      x,
      y,
      kind: "link",
      sourceUrl: page.finalUrl,
      title: card.title,
      siteName: card.siteName,
      errorStatus: 422,
    });
  } catch (e) {
    return apiError(e);
  }
}

/** Card title/site name for a page import, normalized per platform. */
function cardMeta(
  platform: SocialPlatform | null,
  finalUrl: string,
  meta: OgMeta
): { title: string | null; siteName: string | null } {
  const hostname = new URL(finalUrl).hostname.replace(/^www\./, "");
  const title = meta.title?.slice(0, 300) || null;

  if (platform === "tiktok") {
    const username = tiktokUsername(new URL(finalUrl));
    // TikTok's OG title is the creator's display name ("TikTok · Scout").
    const displayName = meta.title?.replace(/^TikTok\s*[·|-]\s*/i, "").trim() ?? "";
    return {
      title:
        displayName && displayName.toLowerCase() !== "tiktok"
          ? displayName.slice(0, 300)
          : null,
      siteName: username ? `@${username}` : "TikTok",
    };
  }
  if (platform === "pinterest") {
    return { title, siteName: "Pinterest" };
  }
  return { title, siteName: meta.siteName || hostname };
}

/** Validate + measure an image buffer, store it, and create the item record. */
async function importImage(args: {
  projectId: string;
  userId: string;
  url: string;
  buffer: Buffer;
  contentType: string;
  x: number;
  y: number;
  kind?: "image" | "link";
  sourceUrl?: string | null;
  title?: string | null;
  siteName?: string | null;
  errorStatus: number;
}): Promise<Response> {
  const ext = extFromMime(args.contentType);
  if (!ext) return json({ error: "That image format is not supported" }, 415);

  let dims: { width: number; height: number };
  try {
    const d = imageSize(args.buffer);
    dims = { width: d.width, height: d.height };
  } catch {
    return json(
      { error: args.kind === "link" ? "The page's preview image could not be loaded" : "Unsupported or corrupt image" },
      args.errorStatus
    );
  }

  // Link cards get a footer strip, so the card is created taller than the
  // thumbnail: the image area keeps the thumbnail's aspect ratio.
  const height = args.kind === "link" ? dims.height + LINK_FOOTER_HEIGHT : dims.height;

  try {
    const item = await createItemWithObject({
      projectId: args.projectId,
      userId: args.userId,
      buffer: args.buffer,
      mime: args.contentType,
      originalName: (args.title ?? args.url.split("/").pop()) || "image",
      width: dims.width,
      height,
      x: args.x,
      y: args.y + (args.kind === "link" ? LINK_FOOTER_HEIGHT / 2 : 0),
      kind: args.kind,
      sourceUrl: args.sourceUrl ?? null,
      title: args.title ?? null,
      siteName: args.siteName ?? null,
    });
    broadcastUpsert(String(args.projectId), "item", itemJSON(item));
    return json({ item: itemJSON(item) }, 201);
  } catch (e) {
    if (e instanceof ObjectStoreError) {
      return json({ error: "Could not store the image, please try again" }, 500);
    }
    return apiError(e);
  }
}
