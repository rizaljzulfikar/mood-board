import type { ItemDoc } from "./models/Item";

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
    addedBy: String(item.addedBy),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
