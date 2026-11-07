import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { User } from "@/lib/models/User";
import { apiError, ApiError, json, requireMember } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);
    if (!project.owner.equals(user.id)) {
      throw new ApiError(403, "Only the owner can manage members");
    }
    const body = (await req.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) return json({ error: "Email is required" }, 400);

    await connectDB();
    const target = await User.findOne({ email });
    if (!target) return json({ error: "No MoodBoard account with that email" }, 404);
    if (project.owner.equals(target._id) || project.members.some((m) => m.equals(target._id))) {
      return json({ error: "Already a member" }, 409);
    }

    await Project.updateOne({ _id: project._id }, { $addToSet: { members: target._id } });
    const fresh = await Project.findById(project._id);
    return json({ ok: true, memberCount: 1 + (fresh?.members.length ?? 0) });  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);
    const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase();
    if (!email) return json({ error: "Email query parameter is required" }, 400);

    await connectDB();
    const target = await User.findOne({ email });
    if (!target) return json({ error: "No MoodBoard account with that email" }, 404);

    const isOwner = project.owner.equals(user.id);
    const removingSelf = target._id.equals(user.id);
    if (!isOwner && !removingSelf) {
      throw new ApiError(403, "Only the owner can remove other members");
    }
    if (project.owner.equals(target._id)) {
      return json({ error: "The owner cannot be removed" }, 400);
    }
    if (!project.members.some((m) => m.equals(target._id))) {
      return json({ error: "Not a member" }, 404);
    }

    await Project.updateOne({ _id: project._id }, { $pull: { members: target._id } });
    const fresh = await Project.findById(project._id);
    return json({ ok: true, memberCount: 1 + (fresh?.members.length ?? 0) });
  } catch (e) {
    return apiError(e);
  }
}
