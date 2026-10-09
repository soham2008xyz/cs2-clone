import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode, type ServerMsg } from '@cs2d/shared';
import { Connection } from '../src/net/connection.js';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function open(conn: Connection): FakeSocket {
  const p = conn.connect('ws://x?room=ABCD');
  const sock = FakeSocket.last;
  sock.readyState = FakeSocket.OPEN;
  sock.onopen!();
  void p;
  return sock;
}

describe('Connection.connect', () => {
  it('resolves once the socket opens', async () => {
    const conn = new Connection();
    const p = conn.connect('ws://x?room=ABCD');
    expect(FakeSocket.last.url).toBe('ws://x?room=ABCD');
    FakeSocket.last.onopen!();
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects naming the url when the socket errors before opening', async () => {
    const conn = new Connection();
    const p = conn.connect('ws://nope');
    FakeSocket.last.onerror!();
    await expect(p).rejects.toThrow('cannot reach ws://nope');
  });

  it('reports the close code and reason', () => {
    const conn = new Connection();
    const onClose = vi.fn();
    conn.onClose = onClose;
    const sock = open(conn);
    sock.onclose!({ code: 4004, reason: 'room not found' });
    expect(onClose).toHaveBeenCalledWith(4004, 'room not found');
  });
});

describe('Connection message routing', () => {
  const cases: Array<[ServerMsg, keyof Connection]> = [
    [{ t: 'welcome', id: 1, map: 'dust2', tick: 0 }, 'onWelcome'],
    [{ t: 'roster', players: [] }, 'onRoster'],
    [{ t: 'chat', from: 'a', team: null, text: 'hi' }, 'onChat'],
    [{ t: 'pong', t0: 5 }, 'onPong'],
    [{ t: 's', k: 1, a: 0, p: [] } as unknown as ServerMsg, 'onSnapshot'],
  ];

  it.each(cases)('delivers %j to %s only', (msg, handler) => {
    const conn = new Connection();
    const handlers = ['onWelcome', 'onRoster', 'onChat', 'onPong', 'onSnapshot'] as const;
    const spies = Object.fromEntries(handlers.map((h) => [h, vi.fn()]));
    for (const h of handlers) (conn as unknown as Record<string, unknown>)[h] = spies[h];
    const sock = open(conn);
    sock.onmessage!({ data: encode(msg) });
    for (const h of handlers) {
      if (h === handler) expect(spies[h]).toHaveBeenCalledWith(msg);
      else expect(spies[h]).not.toHaveBeenCalled();
    }
  });

  it('ignores message types it does not know', () => {
    const conn = new Connection();
    const onWelcome = vi.fn();
    conn.onWelcome = onWelcome;
    const sock = open(conn);
    expect(() => sock.onmessage!({ data: JSON.stringify({ t: 'mystery' }) })).not.toThrow();
    expect(onWelcome).not.toHaveBeenCalled();
  });

  it('default handlers are harmless no-ops', () => {
    const conn = new Connection();
    const sock = open(conn);
    for (const msg of [{ t: 'welcome', id: 1, map: 'm', tick: 0 }, { t: 'roster', players: [] }, { t: 'chat', from: 'a', team: null, text: 'x' }, { t: 'pong', t0: 1 }, { t: 's' }]) {
      expect(() => sock.onmessage!({ data: JSON.stringify(msg) })).not.toThrow();
    }
    expect(() => sock.onclose!({ code: 1000, reason: '' })).not.toThrow();
  });
});

describe('Connection.send / disconnect', () => {
  it('sends encoded messages only while the socket is open', () => {
    const conn = new Connection();
    const sock = open(conn);
    conn.send({ t: 'ping', t0: 1 });
    expect(sock.sent).toEqual([JSON.stringify({ t: 'ping', t0: 1 })]);

    sock.readyState = 3;
    conn.send({ t: 'ping', t0: 2 });
    expect(sock.sent).toHaveLength(1);
  });

  it('detaches handlers on deliberate disconnect so it is not reported as a drop', () => {
    const conn = new Connection();
    const onClose = vi.fn();
    conn.onClose = onClose;
    const sock = open(conn);
    conn.disconnect();
    expect(sock.closed).toBe(true);
    expect(sock.onclose).toBeNull();
    expect(sock.onmessage).toBeNull();
    expect(sock.onerror).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disconnect before connect is a no-op', () => {
    expect(() => new Connection().disconnect()).not.toThrow();
  });
});
