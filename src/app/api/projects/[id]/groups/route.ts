import { Types } from "mongoose";
import { apiError, json, requireMember } from "@/lib/api";
import { Group } from "@/lib/models/Group";
import { clampCoord, clampDim, cleanLabel, groupJSON } from "@/lib/groups";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { project } = await requireMember(id);
    const groups = await Group.find({ project: project._id, deletedAt: null }).sort({ z: 1 });
    return json({ groups: groups.map(groupJSON) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const top = await Group.findOne({ project: project._id }).sort({ z: -1 }).select("z");
    const group = await Group.create({
      project: project._id,
      label: cleanLabel(body.label) ?? "",
      x: clampCoord(body.x, 0),
      y: clampCoord(body.y, 0),
      width: clampDim(body.width, 360),
      height: clampDim(body.height, 240),
      z: (top?.z ?? 0) + 1,
      addedBy: new Types.ObjectId(user.id),
      deletedAt: null,
    });

    return json({ group: groupJSON(group) }, 201);
  } catch (e) {
    return apiError(e);
  }
}
