import { Types } from "mongoose";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { Group } from "@/lib/models/Group";
import { Connection } from "@/lib/models/Connection";
import { clampCoord, clampDim, cleanLabel, groupJSON } from "@/lib/groups";
import { connectDB } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    // Connect before querying: on a cold process, a buffered query without a
    // connection would time out as a 500.
    await connectDB();
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "Group not found");
    const body = (await req.json()) as Record<string, unknown>;
    const group = await Group.findById(id);
    if (!group) throw new ApiError(404, "Group not found");
    await requireMember(String(group.project));

    // Undo/redo reconcile: `deleted: true` re-deletes a live group,
    // `deleted: false` un-deletes one (optionally with field updates).
    if (body.deleted === true) {
      if (group.deletedAt) throw new ApiError(404, "Group not found");
      group.deletedAt = new Date();
      await group.save();
      return json({ group: groupJSON(group) });
    }
    if (group.deletedAt && body.deleted !== false) throw new ApiError(404, "Group not found");
    if (body.deleted === false) group.deletedAt = null;

    const label = cleanLabel(body.label);
    if (label !== undefined) group.label = label;
    if (body.x !== undefined) group.x = clampCoord(body.x, group.x);
    if (body.y !== undefined) group.y = clampCoord(body.y, group.y);
    if (body.width !== undefined) group.width = clampDim(body.width, group.width);
    if (body.height !== undefined) group.height = clampDim(body.height, group.height);
    if (typeof body.z === "number" && Number.isFinite(body.z)) group.z = Math.round(body.z);

    await group.save();
    return json({ group: groupJSON(group) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await connectDB();
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "Group not found");
    const group = await Group.findById(id);
    if (!group || group.deletedAt) throw new ApiError(404, "Group not found");
    await requireMember(String(group.project));

    // Soft delete so other clients' next sync learns about the removal.
    // Connections dangling on this group go with it: an edge without both
    // endpoints is unrenderable.
    const now = new Date();
    group.deletedAt = now;
    await group.save();
    await Connection.updateMany(
      { project: group.project, deletedAt: null, $or: [{ from: group._id }, { to: group._id }] },
      { deletedAt: now }
    );
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
