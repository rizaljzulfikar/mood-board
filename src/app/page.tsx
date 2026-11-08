import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";

export const dynamic = "force-dynamic";

export default async function Home() {
  await connectDB();
  if (!(await User.exists({}))) redirect("/setup");
  const user = await getCurrentUser();
  redirect(user ? "/projects" : "/login");
}
