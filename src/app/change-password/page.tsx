import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

export const dynamic = "force-dynamic";

/** Serves both flows: the forced first-login rotation and the voluntary
 * "change my password" entry from the header links. */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <main className="auth-page">
      <ChangePasswordForm mustChangePassword={user.mustChangePassword} />
    </main>
  );
}
