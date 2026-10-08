import type { IncomingHttpHeaders } from 'node:http';
import { resolve, sep } from 'node:path';
import type { RawData } from 'ws';
import type { BotDifficulty } from './bots/bot.js';

const BOT_DIFFICULTIES = new Set<unknown>(['easy', 'normal', 'hard'] satisfies BotDifficulty[]);

/** Untrusted difficulty from the wire, falling back to 'normal' for anything unknown. */
export function validDifficulty(d: unknown): BotDifficulty {
  return BOT_DIFFICULTIES.has(d) ? (d as BotDifficulty) : 'normal';
}

/** Parse a request target (path + query); the host is irrelevant, so use a fixed base. */
export function parseRequestUrl(raw: string | undefined): URL {
  const base = 'http://localhost';
  try {
    return new URL(raw ?? '/', base);
  } catch {
    return new URL('/', base); // malformed absolute-form target: treat as root rather than crash
  }
}

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

/**
 * Client address for rate limiting. Behind a trusted proxy each hop appends the
 * address it saw to x-forwarded-for, so the entry `trustedHops` from the right
 * is the one our own proxy vouches for; anything left of it is client-supplied
 * and forgeable. With no trusted proxy the header is ignored entirely.
 */
export function clientIp(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }, trustedHops: number): string {
  if (trustedHops > 0) {
    const header = req.headers['x-forwarded-for'];
    const parts = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const hop = parts[parts.length - trustedHops];
    if (hop) return hop;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Non-negative integer from an env var, or `fallback` when unset or malformed. */
export function envInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
