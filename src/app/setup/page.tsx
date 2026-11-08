import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { SetupForm } from "@/components/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await getCurrentUser()) redirect("/projects");
  await connectDB();
  if (await User.exists({})) redirect("/login");
  return (
    <main className="auth-page">
      <SetupForm />
    </main>
  );
}
