import { apiError, json, requireMember } from "@/lib/api";
import { Item } from "@/lib/models/Item";
import { Group } from "@/lib/models/Group";
import { Connection } from "@/lib/models/Connection";
import { itemJSON } from "@/lib/items";
import { groupJSON, connectionJSON } from "@/lib/groups";
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
    const changedSince = since && !Number.isNaN(since.getTime()) ? { updatedAt: { $gt: since } } : {};
    const projectFilter = { project: project._id, ...changedSince };

    const changedItems = await Item.find(projectFilter).sort({ z: 1 });
    const changedGroups = await Group.find(projectFilter).sort({ z: 1 });
    const changedConnections = await Connection.find(projectFilter).sort({ createdAt: 1 });

    const active = listActive(String(project._id)).filter((u) => u.userId !== user.id);

    return json({
      items: changedItems.filter((i) => !i.deletedAt).map(itemJSON),
      deletedIds: changedItems.filter((i) => i.deletedAt).map((i) => String(i._id)),
      groups: changedGroups.filter((g) => !g.deletedAt).map(groupJSON),
      deletedGroupIds: changedGroups.filter((g) => g.deletedAt).map((g) => String(g._id)),
      connections: changedConnections.filter((c) => !c.deletedAt).map(connectionJSON),
      deletedConnectionIds: changedConnections
        .filter((c) => c.deletedAt)
        .map((c) => String(c._id)),
      users: active,
      now: syncCursor(snapshot),
    });
  } catch (e) {
    return apiError(e);
  }
}
