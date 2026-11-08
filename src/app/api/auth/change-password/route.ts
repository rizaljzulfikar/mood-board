import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { apiError, json } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/session";

export const runtime = "nodejs";

/** Rotate a temporary password. Uses getCurrentUser directly — requireUser
 * would reject must-change users, who are exactly who this serves. */
export async function POST(req: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) return json({ error: "Not authenticated" }, 401);

    const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
    const currentPassword = body.currentPassword ?? "";
    const newPassword = body.newPassword ?? "";

    if (newPassword.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    await connectDB();
    const user = await User.findById(sessionUser.id);
    if (!user) return json({ error: "Not authenticated" }, 401);

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return json({ error: "Current password is incorrect" }, 400);

    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } }
    );
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
