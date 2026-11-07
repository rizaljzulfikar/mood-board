import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { getObject } from "@/lib/minio";
import { parseStorageKey } from "@/lib/storage-key";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const { key } = await ctx.params;
    const parsed = parseStorageKey(key);
    if (!parsed) throw new ApiError(404, "Not found");
    // Membership check is what makes the private bucket safe to proxy.
    await requireMember(parsed.projectId);

    const obj = await getObject(`${parsed.projectId}/${parsed.filename}`);
    const headers = new Headers({
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    if (obj.contentLength !== undefined) headers.set("Content-Length", String(obj.contentLength));
    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return apiError(e);
  }
}
