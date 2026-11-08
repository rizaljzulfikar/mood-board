import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { CreateProjectForm } from "@/components/CreateProjectForm";
import { LogoutButton } from "@/components/LogoutButton";
import { ProjectList, type ListProject } from "@/components/ProjectList";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  await connectDB();
  const projects = await Project.find({ $or: [{ owner: user.id }, { members: user.id }] })
    .sort({ updatedAt: -1 })
    .populate("owner", "email name");

  const list: ListProject[] = projects.map((p) => ({
    id: String(p._id),
    name: p.name,
    role: p.owner.equals(user.id) ? "owner" : "member",
    memberCount: 1 + p.members.length,
    archived: p.archived ?? false,
  }));

  return (
    <main className="projects-page">
      <header className="projects-header">
        <h1>MoodBoard</h1>
        <div className="projects-user">
          <span>{user.name}</span>
          <Link href="/change-password" className="ghost-button">
            Change password
          </Link>
          {user.role === "superadmin" && (
            <Link href="/users" className="ghost-button">
              Users
            </Link>
          )}
          <LogoutButton />
        </div>
      </header>

      <CreateProjectForm />

      <ProjectList projects={list} />
    </main>
  );
}
