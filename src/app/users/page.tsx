import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { InviteUserForm } from "@/components/InviteUserForm";
import { UserManagement } from "@/components/UserManagement";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (user.role !== "superadmin") redirect("/projects");
  await connectDB();
  const users = await User.find({}).sort({ createdAt: 1, name: 1 });

  return (
    <main className="projects-page">
      <header className="projects-header">
        <h1>Users</h1>
        <div className="projects-user">
          <Link href="/projects" className="ghost-button">
            Projects
          </Link>
          <Link href="/change-password" className="ghost-button">
            Change password
          </Link>
          <LogoutButton />
        </div>
      </header>

      <InviteUserForm />

      <UserManagement
        currentUserId={user.id}
        users={users.map((u) => ({
          id: String(u._id),
          name: u.name,
          email: u.email,
          role: u.role,
          mustChangePassword: u.mustChangePassword,
        }))}
      />
    </main>
  );
}
