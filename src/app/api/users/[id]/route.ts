import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { User } from "@/lib/models/User";
import { apiError, ApiError, json, requireSuperadmin } from "@/lib/api";

export const runtime = "nodejs";

/** Superadmin-only: delete a user account. Memberships are pulled from every
 * project; owned projects transfer to the superadmin so nothing is orphaned.
 * The superadmin account itself cannot be deleted. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "User not found");
    const actor = await requireSuperadmin();

    await connectDB();
    const target = await User.findById(id);
    if (!target) throw new ApiError(404, "User not found");
    if (target.role === "superadmin") {
      throw new ApiError(400, "The superadmin account cannot be deleted");
    }

    // Ownership transfer pulls the new owner out of members in the same
    // update: an owner must never also sit in the members array.
    await Project.updateMany(
      { owner: target._id },
      {
        $set: { owner: new Types.ObjectId(actor.id) },
        $pull: { members: new Types.ObjectId(actor.id) },
      }
    );
    await Project.updateMany(
      { members: target._id },
      { $pull: { members: target._id } }
    );
    await target.deleteOne();
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
