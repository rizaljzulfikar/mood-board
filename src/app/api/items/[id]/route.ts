import { Types } from "mongoose";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Item } from "@/lib/models/Item";
import { itemJSON } from "@/lib/items";
import { cleanLabel } from "@/lib/groups";

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
    const item = await Item.findById(id);
    if (!item || item.deletedAt) throw new ApiError(404, "Item not found");
    await requireMember(String(item.project));

    const body = (await req.json()) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const x = num(body.x);
    const y = num(body.y);
    let width = num(body.width);
    let height = num(body.height);
    const rotation = num(body.rotation);
    const z = num(body.z);
    const label = cleanLabel(body.label);

    if (width !== undefined) width = Math.min(MAX_DIM, Math.max(MIN_DIM, width));
    if (height !== undefined) height = Math.min(MAX_DIM, Math.max(MIN_DIM, height));

    if (x !== undefined) item.x = x;
    if (y !== undefined) item.y = y;
    if (width !== undefined) item.width = width;
    if (height !== undefined) item.height = height;
    if (rotation !== undefined) item.rotation = rotation;
    if (z !== undefined) item.z = Math.round(z);
    if (label !== undefined) item.label = label;

    await item.save();
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
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
