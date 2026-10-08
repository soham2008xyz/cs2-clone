import { resolve, sep } from 'node:path';
import type { RawData } from 'ws';

/**
 * Map a request pathname onto a file inside `root`. Returns null when the
 * resolved path would escape `root` (path traversal), so callers never touch
 * the filesystem with an unchecked path.
 */
export function resolveStaticFile(root: string, pathname: string): string | null {
  const base = resolve(root);
  const file = resolve(base, pathname === '/' ? 'index.html' : `.${pathname}`);
  return file.startsWith(base + sep) ? file : null;
}

/** Decode a ws message payload (Buffer, ArrayBuffer or fragmented Buffer[]) as UTF-8. */
export function rawDataToString(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}
