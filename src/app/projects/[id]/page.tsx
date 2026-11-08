import { Types } from "mongoose";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";
import { itemJSON } from "@/lib/items";
import { Board } from "@/components/Board";
import type { ProjectInfo } from "@/components/Toolbar";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  if (!Types.ObjectId.isValid(id)) notFound();
  await connectDB();
  const project = await Project.findById(id);
  if (!project) notFound();

  const isMember =
    project.owner.equals(user.id) ||
    project.members.some((m: Types.ObjectId) => m.equals(user.id));
  if (!isMember) redirect("/projects");

  await project.populate([
    { path: "owner", select: "email name" },
    { path: "members", select: "email name" },
  ]);
  const owner = project.owner as unknown as { _id: Types.ObjectId; email: string; name: string };
  const members = project.members as unknown as Array<{
    _id: Types.ObjectId;
    email: string;
    name: string;
  }>;

  const items = await Item.find({ project: project._id, deletedAt: null }).sort({ z: 1 });

  const info: ProjectInfo = {
    id,
    name: project.name,
    role: project.owner.equals(user.id) ? "owner" : "member",
    owner: { id: String(owner._id), email: owner.email, name: owner.name },
    members: members.map((m) => ({ id: String(m._id), email: m.email, name: m.name })),
  };

  return (
    <Board
      projectId={id}
      initialItems={items.map(itemJSON)}
      user={{ id: user.id, name: user.name }}
      project={info}
    />
  );
}
