import {
  decode,
  encode,
  type ChatBroadcastMsg,
  type ClientMsg,
  type PongMsg,
  type RosterMsg,
  type ServerMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@cs2d/shared';

export class Connection {
  private ws!: WebSocket;
  onWelcome: (msg: WelcomeMsg) => void = () => {};
  onSnapshot: (msg: SnapshotMsg) => void = () => {};
  onRoster: (msg: RosterMsg) => void = () => {};
  onChat: (msg: ChatBroadcastMsg) => void = () => {};
  onPong: (msg: PongMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error(`cannot reach ${url}`));
      this.ws.onclose = () => this.onClose();
      this.ws.onmessage = (ev) => {
        const msg = decode<ServerMsg>(ev.data as string);
        if (msg.t === 's') this.onSnapshot(msg);
        else if (msg.t === 'welcome') this.onWelcome(msg);
        else if (msg.t === 'roster') this.onRoster(msg);
        else if (msg.t === 'chat') this.onChat(msg);
        else if (msg.t === 'pong') this.onPong(msg);
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  disconnect(): void {
    this.ws?.close();
  }
}

export function serverUrl(roomCode: string): string {
  const room = encodeURIComponent(roomCode);
  // vite dev server: game server runs separately on :8090; otherwise same origin
  if (location.port === '5173') return `ws://${location.hostname || 'localhost'}:8090?room=${room}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}?room=${room}`;
}
