/**
 * The sync cursor must be a snapshot taken BEFORE the delta query runs:
 * a change landing between the query and cursor generation would otherwise
 * be skipped by the next poll's `$gt` and lost forever. We subtract 1 ms so
 * same-millisecond updates are re-delivered; the client merge deduplicates.
 */
export function syncCursor(now: Date): string {
  return new Date(now.getTime() - 1).toISOString();
}
