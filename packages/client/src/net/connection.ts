import { decode, encode, type ClientMsg, type RosterMsg, type ServerMsg, type SnapshotMsg, type WelcomeMsg } from '@cs2d/shared';

export class Connection {
  private ws!: WebSocket;
  onWelcome: (msg: WelcomeMsg) => void = () => {};
  onSnapshot: (msg: SnapshotMsg) => void = () => {};
  onRoster: (msg: RosterMsg) => void = () => {};
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
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }
}

export function serverUrl(): string {
  const host = location.hostname || 'localhost';
  return `ws://${host}:8090`;
}
