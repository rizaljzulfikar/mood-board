/**
 * Storage object keys have the fixed shape "{projectId}/{itemId}.{ext}".
 * Both segments are generated server-side (ObjectId hex + controlled ext),
 * and the proxy route re-validates every incoming segment defensively.
 */

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function buildObjectKey(
  projectId: string,
  itemId: string,
  ext: string
): string {
  return `${projectId}/${itemId}.${ext}`;
}

export function parseStorageKey(
  segments: string[]
): { projectId: string; filename: string } | null {
  if (segments.length !== 2) return null;
  const [projectId, filename] = segments;
  if (!SEGMENT_RE.test(projectId) || !SEGMENT_RE.test(filename)) return null;
  if (projectId === "." || projectId === "..") return null;
  if (filename === "." || filename === "..") return null;
  return { projectId, filename };
}
