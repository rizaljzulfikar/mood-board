import { Types } from "mongoose";
import type { ItemDoc } from "./models/Item";
import { Item } from "./models/Item";
import { buildObjectKey } from "./storage-key";
import { putObjectBuffer } from "./minio";
import { normalizeCrop } from "./crop";
import { NOTE_DEFAULT_COLOR, NOTE_MAX_CONTENT_LENGTH } from "./note-format";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export function extFromMime(mime: string): string | null {
  return MIME_EXT[mime.toLowerCase()] ?? null;
}

export function itemJSON(item: ItemDoc) {
  return {
    id: String(item._id),
    kind: item.kind ?? "image",
    objectKey: item.objectKey,
    originalName: item.originalName,
    mime: item.mime,
    size: item.size,
    width: item.width,
    height: item.height,
    x: item.x,
    y: item.y,
    rotation: item.rotation,
    z: item.z,
    crop: normalizeCrop(item.crop),
    sourceUrl: item.sourceUrl ?? null,
    title: item.title ?? null,
    siteName: item.siteName ?? null,
    label: item.label ?? "",
    content: (item.content ?? "").slice(0, NOTE_MAX_CONTENT_LENGTH),
    color: item.color ?? NOTE_DEFAULT_COLOR,
    addedBy: String(item.addedBy),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export type CreateItemInput = {
  projectId: string;
  userId: string;
  buffer: Buffer;
  mime: string;
  originalName: string;
  width: number;
  height: number;
  /** Requested center point; the item is positioned so its center lands there. */
  x: number;
  y: number;
  kind?: "image" | "link";
  sourceUrl?: string | null;
  title?: string | null;
  siteName?: string | null;
};

/**
 * Shared item-creation pipeline for uploads and URL imports:
 * store the object first (storage failure → clean 500, no record), then
 * create the record (record failure → the orphaned object is removed).
 */
export async function createItemWithObject(input: CreateItemInput): Promise<ItemDoc> {
  const top = await Item.findOne({ project: input.projectId }).sort({ z: -1 }).select("z");
  const z = (top?.z ?? 0) + 1;

  const itemId = new Types.ObjectId();
  const ext = extFromMime(input.mime);
  if (!ext) throw new Error(`unsupported mime: ${input.mime}`);
  const objectKey = buildObjectKey(input.projectId, String(itemId), ext);

  const doc = {
    _id: itemId,
    project: new Types.ObjectId(input.projectId),
    kind: input.kind ?? "image",
    objectKey,
    originalName: input.originalName,
    mime: input.mime,
    size: input.buffer.byteLength,
    width: input.width,
    height: input.height,
    x: input.x - input.width / 2,
    y: input.y - input.height / 2,
    z,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    sourceUrl: input.sourceUrl ?? null,
    title: input.title ?? null,
    siteName: input.siteName ?? null,
    label: "",
    addedBy: new Types.ObjectId(input.userId),
    deletedAt: null,
  };

  try {
    await putObjectBuffer(objectKey, input.buffer, input.mime);
  } catch (e) {
    console.error("[items] object upload failed:", e);
    throw new ObjectStoreError();
  }

  try {
    return await Item.create(doc);
  } catch (e) {
    // Don't leave an orphaned object behind.
    try {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const { getS3Client, bucketName } = await import("@/lib/minio");
      await getS3Client().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: objectKey }));
    } catch (cleanupErr) {
      console.error("[items] orphan object cleanup failed:", cleanupErr);
    }
    throw e;
  }
}

/** Storage write failure — maps to a retryable 500, nothing was persisted. */
export class ObjectStoreError extends Error {
  constructor() {
    super("object store unavailable");
  }
}
