import { Types } from "mongoose";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { Connection, type ConnectionStyle } from "@/lib/models/Connection";
import { Group } from "@/lib/models/Group";
import { connectionJSON } from "@/lib/groups";

export const runtime = "nodejs";

function toStyle(value: unknown): ConnectionStyle | null {
  return value === "arrow" || value === "line" ? value : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { project } = await requireMember(id);
    const connections = await Connection.find({
      project: project._id,
      deletedAt: null,
    }).sort({ createdAt: 1 });
    return json({ connections: connections.map(connectionJSON) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const fromId = typeof body.fromId === "string" ? body.fromId : "";
    const toId = typeof body.toId === "string" ? body.toId : "";
    if (!Types.ObjectId.isValid(fromId) || !Types.ObjectId.isValid(toId)) {
      throw new ApiError(400, "fromId and toId must be group ids");
    }
    if (fromId === toId) throw new ApiError(400, "Cannot connect a group to itself");

    // Both endpoints must be live groups of this project.
    const endpoints = await Group.find({
      _id: { $in: [fromId, toId] },
      project: project._id,
      deletedAt: null,
    });
    if (endpoints.length !== 2) throw new ApiError(404, "Group not found");

    const style = toStyle(body.style) ?? "arrow";
    const connection = await Connection.create({
      project: project._id,
      from: new Types.ObjectId(fromId),
      to: new Types.ObjectId(toId),
      style,
      addedBy: new Types.ObjectId(user.id),
      deletedAt: null,
    });

    return json({ connection: connectionJSON(connection) }, 201);
  } catch (e) {
    return apiError(e);
  }
}
