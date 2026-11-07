import { apiError, json, requireMember } from "@/lib/api";
import { Item } from "@/lib/models/Item";
import { itemJSON } from "@/lib/items";
import { heartbeat, listActive, type Cursor } from "@/lib/presence";
import { syncCursor } from "@/lib/sync";

export const runtime = "nodejs";

/**
 * Heartbeat + poll in one call: the client sends the timestamp of its last
 * sync and (optionally) its cursor; the server records presence and returns
 * everything that changed since.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);

    const body = (await req.json().catch(() => ({}))) as {
      since?: string;
      cursor?: { x?: unknown; y?: unknown };
    };

    const cursor: Cursor =
      body.cursor &&
      typeof body.cursor.x === "number" &&
      Number.isFinite(body.cursor.x) &&
      typeof body.cursor.y === "number" &&
      Number.isFinite(body.cursor.y)
        ? { x: body.cursor.x, y: body.cursor.y }
        : null;
    heartbeat(String(project._id), user.id, user.name, cursor);

    // Snapshot BEFORE querying so nothing changed after this point is skipped
    // by the next poll (see syncCursor).
    const snapshot = new Date();
    const since = body.since ? new Date(body.since) : null;
    const changed = await Item.find({
      project: project._id,
      ...(since && !Number.isNaN(since.getTime()) ? { updatedAt: { $gt: since } } : {}),
    }).sort({ z: 1 });

    const active = listActive(String(project._id)).filter((u) => u.userId !== user.id);

    return json({
      items: changed.filter((i) => !i.deletedAt).map(itemJSON),
      deletedIds: changed.filter((i) => i.deletedAt).map((i) => String(i._id)),
      users: active,
      now: syncCursor(snapshot),
    });
  } catch (e) {
    return apiError(e);
  }
}
