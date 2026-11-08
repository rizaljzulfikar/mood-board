import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { apiError, ApiError, json, requireSuperadmin } from "@/lib/api";
import { generateTempPassword, hashPassword } from "@/lib/session";

export const runtime = "nodejs";

/** Superadmin-only: issue a new temporary password for a user. The user must
 * rotate it at next login — the same flow as a fresh invitation. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "User not found");
    const actor = await requireSuperadmin();

    await connectDB();
    const target = await User.findById(id);
    if (!target) throw new ApiError(404, "User not found");
    if (target._id.equals(actor.id)) {
      // Resetting your own password would bounce you to /change-password
      // before the one-time temporary password is shown — an unrecoverable
      // lockout for the only superadmin.
      throw new ApiError(400, "You cannot reset your own password here");
    }

    const temporaryPassword = generateTempPassword();
    await User.updateOne(
      { _id: target._id },
      {
        $set: {
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
        },
      }
    );
    return json({ temporaryPassword });
  } catch (e) {
    return apiError(e);
  }
}
