import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { CreateProjectForm } from "@/components/CreateProjectForm";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  await connectDB();
  const projects = await Project.find({ $or: [{ owner: user.id }, { members: user.id }] })
    .sort({ updatedAt: -1 })
    .populate("owner", "email name");

  return (
    <main className="projects-page">
      <header className="projects-header">
        <h1>MoodBoard</h1>
        <div className="projects-user">
          <span>{user.name}</span>
          {user.role === "superadmin" && (
            <Link href="/users" className="ghost-button">
              Users
            </Link>
          )}
          <LogoutButton />
        </div>
      </header>

      <CreateProjectForm />

      {projects.length === 0 ? (
        <p className="projects-empty">
          No projects yet — create one above, then drag images onto its canvas.
        </p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={String(p._id)}>
              <Link href={`/projects/${p._id}`} className="project-card">
                <span className="project-name">{p.name}</span>
                <span className="project-meta">
                  {p.owner.equals(user.id) ? "Owner" : "Member"} ·{" "}
                  {1 + p.members.length} {1 + p.members.length === 1 ? "member" : "members"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
