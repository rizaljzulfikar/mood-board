import { apiError, json, requireMember } from "@/lib/api";
import { signRoomTicket } from "@/lib/realtime-ticket";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user } = await requireMember(id);
    return json({ ticket: await signRoomTicket(id, user.id, user.name) });
  } catch (e) {
    return apiError(e);
  }
}
