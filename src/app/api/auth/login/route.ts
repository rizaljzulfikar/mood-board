import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { startSession } from "@/lib/auth";
import { apiError, json } from "@/lib/api";
import { verifyPassword } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    await connectDB();
    const user = await User.findOne({ email });
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) return json({ error: "Invalid email or password" }, 401);

    await startSession(String(user._id));
    return json({
      user: { id: String(user._id), email: user.email, name: user.name },
      mustChangePassword: user.mustChangePassword,
    });
  } catch (e) {
    return apiError(e);
  }
}
