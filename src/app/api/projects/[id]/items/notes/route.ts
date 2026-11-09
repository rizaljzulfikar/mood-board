import { Types } from "mongoose";
import { apiError, json, requireMember } from "@/lib/api";
import { Item } from "@/lib/models/Item";
import { itemJSON } from "@/lib/items";
import { sanitizeNoteContent } from "@/lib/note-content";
import {
  NOTE_DEFAULT_COLOR,
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  cleanNoteColor,
  clampNoteCoord,
  clampNoteDim,
} from "@/lib/note-format";
import { broadcastUpsert } from "@/lib/realtime-publish";

export const runtime = "nodejs";

/**
 * Create a sticky note (an item with kind "note"). Notes have no storage
 * object — objectKey is a unique placeholder so the shared schema and its
 * unique index stay untouched.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const top = await Item.findOne({ project: project._id }).sort({ z: -1 }).select("z");
    const itemId = new Types.ObjectId();
    const note = await Item.create({
      _id: itemId,
      project: project._id,
      kind: "note",
      objectKey: `notes/${itemId}`,
      originalName: "Note",
      mime: "text/html",
      size: 0,
      x: clampNoteCoord(body.x, 0),
      y: clampNoteCoord(body.y, 0),
      width: clampNoteDim(body.width, NOTE_DEFAULT_WIDTH),
      height: clampNoteDim(body.height, NOTE_DEFAULT_HEIGHT),
      z: (top?.z ?? 0) + 1,
      rotation: 0,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      content: sanitizeNoteContent(body.content),
      color: cleanNoteColor(body.color) ?? NOTE_DEFAULT_COLOR,
      addedBy: new Types.ObjectId(user.id),
      deletedAt: null,
    });

    broadcastUpsert(String(project._id), "item", itemJSON(note));
    return json({ item: itemJSON(note) }, 201);
  } catch (e) {
    return apiError(e);
  }
}
