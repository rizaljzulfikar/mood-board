import { Types } from "mongoose";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { Connection, type ConnectionStyle } from "@/lib/models/Connection";
import { connectionJSON } from "@/lib/groups";
import { connectDB } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await connectDB();
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "Connection not found");
    const connection = await Connection.findById(id);
    if (!connection || connection.deletedAt) throw new ApiError(404, "Connection not found");
    await requireMember(String(connection.project));

    const body = (await req.json()) as Record<string, unknown>;
    if (body.style === "arrow" || body.style === "line") {
      connection.style = body.style satisfies ConnectionStyle;
    }

    await connection.save();
    return json({ connection: connectionJSON(connection) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await connectDB();
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "Connection not found");
    const connection = await Connection.findById(id);
    if (!connection || connection.deletedAt) throw new ApiError(404, "Connection not found");
    await requireMember(String(connection.project));

    // Soft delete so other clients' next sync learns about the removal.
    connection.deletedAt = new Date();
    await connection.save();
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
