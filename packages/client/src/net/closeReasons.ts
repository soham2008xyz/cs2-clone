/** Player-facing text for websocket close codes the server sends (see server/src/index.ts). */
const CLOSE_MESSAGES: Record<number, string> = {
  4003: 'room full',
  4004: 'room not found',
};

/** Browser-generated codes: no server involved. */
const ABNORMAL_CLOSE = 1006;

export function closeMessage(code: number, reason = ''): string {
  const known = CLOSE_MESSAGES[code];
  if (known) return known;
  if (code === ABNORMAL_CLOSE) return 'disconnected from server';
  return reason ? `disconnected: ${reason}` : 'disconnected from server';
}
