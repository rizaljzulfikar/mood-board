import { apiError, json, requireMember } from "@/lib/api";
import { imageSize } from "image-size";
import { Item } from "@/lib/models/Item";
import { createItemWithObject, extFromMime, itemJSON, MAX_UPLOAD_BYTES, ObjectStoreError } from "@/lib/items";
import { broadcastUpsert } from "@/lib/realtime-publish";

export const runtime = "nodejs";

/** Parse an upload coordinate: any non-finite input falls back to 0. */
function toCoord(value: FormDataEntryValue | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { project } = await requireMember(id);
    const items = await Item.find({ project: project._id, deletedAt: null }).sort({ z: 1, createdAt: 1 });
    return json({ items: items.map(itemJSON) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Missing file field" }, 400);
    const ext = extFromMime(file.type);
    if (!ext) return json({ error: "Only image uploads are allowed" }, 415);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Image is larger than 20 MB" }, 413);

    const buffer = Buffer.from(await file.arrayBuffer());
    let dims: { width: number; height: number };
    try {
      const d = imageSize(buffer);
      dims = { width: d.width, height: d.height };
    } catch {
      return json({ error: "Unsupported or corrupt image" }, 415);
    }

    const x = toCoord(form.get("x"));
    const y = toCoord(form.get("y"));

    try {
      const item = await createItemWithObject({
        projectId: String(project._id),
        userId: user.id,
        buffer,
        mime: file.type,
        originalName: file.name || `image.${ext}`,
        width: dims.width,
        height: dims.height,
        x,
        y,
      });
      broadcastUpsert(String(project._id), "item", itemJSON(item));
      return json({ item: itemJSON(item) }, 201);
    } catch (e) {
      if (e instanceof ObjectStoreError) {
        return json({ error: "Could not store the image, please try again" }, 500);
      }
      return apiError(e);
    }
  } catch (e) {
    return apiError(e);
  }
}
