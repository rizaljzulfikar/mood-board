import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { User } from "@/lib/models/User";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { broadcastMembers } from "@/lib/realtime-publish";
import type { MemberSummary } from "@/lib/realtime-protocol";
import type { Types } from "mongoose";

export const runtime = "nodejs";

/** Loads the fresh member list (id/email/name) after a membership change. */
async function memberSummaries(memberIds: Types.ObjectId[]): Promise<MemberSummary[]> {
  const docs = await User.find({ _id: { $in: memberIds } }).select("email name");
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  // Keep the project's member order; skip ids with no matching account.
  return memberIds
    .map((id) => byId.get(String(id)))
    .filter((d): d is (typeof docs)[number] => Boolean(d))
    .map((d) => ({ id: String(d._id), email: d.email, name: d.name }));
}

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
    if (fresh) {
      broadcastMembers(id, await memberSummaries(fresh.members), []);
    }
    return json({ ok: true, memberCount: 1 + (fresh?.members.length ?? 0) });
  } catch (e) {
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
    if (fresh) {
      broadcastMembers(id, await memberSummaries(fresh.members), [String(target._id)]);
    }
    return json({ ok: true, memberCount: 1 + (fresh?.members.length ?? 0) });
  } catch (e) {
    return apiError(e);
  }
}
