import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await connectDB();
  if (!(await User.exists({}))) redirect("/setup");
  if (await getCurrentUser()) redirect("/projects");
  return (
    <main className="auth-page">
      <AuthForm />
    </main>
  );
}
