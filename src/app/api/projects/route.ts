import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { apiError, json, requireUser } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    await connectDB();
    const projects = await Project.find({
      $or: [{ owner: user.id }, { members: user.id }],
    })
      .sort({ updatedAt: -1 })
      .populate("owner", "email name");

    return json({
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        role: p.owner.equals(user.id) ? "owner" : "member",
        memberCount: 1 + p.members.length,
        archived: p.archived ?? false,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) return json({ error: "Project name is required" }, 400);
    if (name.length > 120) return json({ error: "Project name is too long" }, 400);

    await connectDB();
    const project = await Project.create({ name, owner: user.id, members: [] });
    return json({ project: { id: String(project._id), name: project.name, role: "owner", memberCount: 1 } }, 201);
  } catch (e) {
    return apiError(e);
  }
}
