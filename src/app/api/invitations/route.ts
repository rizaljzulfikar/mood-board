import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { apiError, json, requireUser } from "@/lib/api";
import { generateTempPassword, hashPassword } from "@/lib/session";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Superadmin-only: create a user account with a temporary password. */
export async function POST(req: Request) {
  try {
    const actor = await requireUser();
    if (actor.role !== "superadmin") {
      return json({ error: "Only the superadmin can invite users" }, 403);
    }

    const body = (await req.json()) as { email?: string; name?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const name = (body.name ?? "").trim();

    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address" }, 400);
    if (!name) return json({ error: "Name is required" }, 400);

    await connectDB();
    if (await User.exists({ email })) {
      return json({ error: "An account with this email already exists" }, 409);
    }

    const temporaryPassword = generateTempPassword();
    const user = await User.create({
      email,
      name,
      passwordHash: await hashPassword(temporaryPassword),
      role: "user",
      mustChangePassword: true,
    });
    return json(
      {
        user: { id: String(user._id), email: user.email, name: user.name },
        temporaryPassword,
      },
      201
    );
  } catch (e) {
    return apiError(e);
  }
}
