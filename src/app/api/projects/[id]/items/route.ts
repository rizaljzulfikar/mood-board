import { Types } from "mongoose";
import { imageSize } from "image-size";
import { apiError, json, requireMember } from "@/lib/api";
import { Item } from "@/lib/models/Item";
import { buildObjectKey } from "@/lib/storage-key";
import { putObjectBuffer } from "@/lib/minio";
import { MAX_UPLOAD_BYTES, extFromMime, itemJSON } from "@/lib/items";

export const runtime = "nodejs";

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

    const x = Number(form.get("x") ?? 0) || 0;
    const y = Number(form.get("y") ?? 0) || 0;
    const top = await Item.findOne({ project: project._id }).sort({ z: -1 }).select("z");
    const z = (top?.z ?? 0) + 1;

    const itemId = new Types.ObjectId();
    const item = await Item.create({
      _id: itemId,
      project: project._id,
      objectKey: buildObjectKey(String(project._id), String(itemId), ext),
      originalName: file.name || `image.${ext}`,
      mime: file.type,
      size: file.size,
      width: dims.width,
      height: dims.height,
      // Center the image on the requested point.
      x: x - dims.width / 2,
      y: y - dims.height / 2,
      z,
      addedBy: new Types.ObjectId(user.id),
      deletedAt: null,
    });

    await putObjectBuffer(item.objectKey, buffer, item.mime);
    return json({ item: itemJSON(item) }, 201);
  } catch (e) {
    return apiError(e);
  }
}
