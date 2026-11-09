import { Types } from "mongoose";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Item } from "@/lib/models/Item";
import { itemJSON } from "@/lib/items";
import { cleanLabel } from "@/lib/groups";
import { normalizeCrop } from "@/lib/crop";
import { sanitizeNoteContent } from "@/lib/note-content";
import { cleanNoteColor } from "@/lib/note-format";
import { broadcastDelete, broadcastUpsert } from "@/lib/realtime-publish";

export const runtime = "nodejs";

const MIN_DIM = 16;
const MAX_DIM = 8000;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    // Connect before querying: on a cold process, a buffered query without a
    // connection would time out as a 500.
    await connectDB();
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "Item not found");
    const body = (await req.json()) as Record<string, unknown>;
    const item = await Item.findById(id);
    if (!item) throw new ApiError(404, "Item not found");
    await requireMember(String(item.project));

    // Undo/redo reconcile: `deleted: true` re-deletes a live item,
    // `deleted: false` un-deletes one (optionally with field updates).
    if (body.deleted === true) {
      if (item.deletedAt) throw new ApiError(404, "Item not found");
      item.deletedAt = new Date();
      await item.save();
      broadcastDelete(String(item.project), "item", String(item._id));
      return json({ item: itemJSON(item) });
    }
    if (item.deletedAt && body.deleted !== false) throw new ApiError(404, "Item not found");
    if (body.deleted === false) item.deletedAt = null;

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const x = num(body.x);
    const y = num(body.y);
    let width = num(body.width);
    let height = num(body.height);
    const rotation = num(body.rotation);
    const z = num(body.z);
    const label = cleanLabel(body.label);
    // Note fields: content is sanitized to the note whitelist, color must be
    // strict `#rrggbb`. Scoped to notes so image/link docs never gain them.
    const isNote = item.kind === "note";
    const content =
      isNote && typeof body.content === "string" ? sanitizeNoteContent(body.content) : undefined;
    const color = isNote ? cleanNoteColor(body.color) : undefined;
    const crop =
      body.crop && typeof body.crop === "object" ? normalizeCrop(body.crop) : undefined;

    if (width !== undefined) width = Math.min(MAX_DIM, Math.max(MIN_DIM, width));
    if (height !== undefined) height = Math.min(MAX_DIM, Math.max(MIN_DIM, height));

    if (x !== undefined) item.x = x;
    if (y !== undefined) item.y = y;
    if (width !== undefined) item.width = width;
    if (height !== undefined) item.height = height;
    if (rotation !== undefined) item.rotation = rotation;
    if (z !== undefined) item.z = Math.round(z);
    if (label !== undefined) item.label = label;
    if (content !== undefined) item.content = content;
    if (color !== undefined) item.color = color;
    if (crop !== undefined) item.set("crop", crop);

    await item.save();
    broadcastUpsert(String(item.project), "item", itemJSON(item));
    return json({ item: itemJSON(item) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await connectDB();
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "Item not found");
    const item = await Item.findById(id);
    if (!item || item.deletedAt) throw new ApiError(404, "Item not found");
    await requireMember(String(item.project));

    // Soft delete so other clients' next sync learns about the removal.
    item.deletedAt = new Date();
    await item.save();
    broadcastDelete(String(item.project), "item", String(item._id));
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
