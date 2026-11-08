import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { startSession } from "@/lib/auth";
import { apiError, json } from "@/lib/api";
import { hashPassword } from "@/lib/session";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One-time bootstrap: creates the superadmin while the system has no users. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; name?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const name = (body.name ?? "").trim();
    const password = body.password ?? "";

    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address" }, 400);
    if (!name) return json({ error: "Name is required" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    await connectDB();
    // Ensure the one-superadmin unique index exists before racing requests create.
    await User.init();
    if (await User.exists({})) return json({ error: "Setup already completed" }, 409);

    try {
      const user = await User.create({
        email,
        name,
        passwordHash: await hashPassword(password),
        role: "superadmin",
      });
      await startSession(String(user._id));
      return json(
        { user: { id: String(user._id), email: user.email, name: user.name, role: user.role } },
        201
      );
    } catch (e) {
      // Lost a race against a concurrent setup request.
      if (e instanceof Error && e.name === "MongoServerError" && "code" in e && e.code === 11000) {
        return json({ error: "Setup already completed" }, 409);
      }
      throw e;
    }
  } catch (e) {
    return apiError(e);
  }
}
