import { ApiError, apiError, json, requireMember } from "@/lib/api";

export const runtime = "nodejs";

/**
 * Toggle a project's archived state. Owner only.
 * Sending `{ archived: false }` restores a project; the default archives it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);
    if (!project.owner.equals(user.id)) {
      throw new ApiError(403, "Only the owner can archive or restore the project");
    }

    const body = (await req.json().catch(() => ({}))) as { archived?: boolean };
    project.archived = body.archived ?? true;
    await project.save();

    return json({ project: { id: String(project._id), archived: project.archived } });
  } catch (e) {
    return apiError(e);
  }
}
