import type { WebSocket } from 'ws';
import {
  buttonsToMove,
  encode,
  getMap,
  MAX_HP,
  PFLAG,
  SNAPSHOT_RATE,
  stepMovement,
  TICK_DT,
  TICK_RATE,
  type CompiledMap,
  type InputMsg,
  type PlayerSnap,
  type RosterEntry,
  type TeamId,
  type Vec2,
} from '@cs2d/shared';

const SNAPSHOT_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);
const MAX_QUEUED_INPUTS = 8; // cap so clients can't bank time and speed-burst

export interface PlayerConn {
  id: number;
  ws: WebSocket | null; // null = bot (later)
  name: string;
  team: TeamId;
  pos: Vec2;
  aim: number;
  hp: number;
  alive: boolean;
  buttons: number;
  lastSeq: number;
  inputQueue: InputMsg[];
}

export class Room {
  readonly map: CompiledMap;
  readonly players = new Map<number, PlayerConn>();
  tick = 0;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(mapName: string) {
    this.map = getMap(mapName);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pickTeam(requested?: TeamId): TeamId {
    if (requested) return requested;
    let t = 0;
    let ct = 0;
    for (const p of this.players.values()) p.team === 'T' ? t++ : ct++;
    return t <= ct ? 'T' : 'CT';
  }

  private spawnPos(team: TeamId): Vec2 {
    const spawns = this.map.spawns[team];
    const used = [...this.players.values()].filter((p) => p.team === team).length;
    return { ...spawns[used % spawns.length] };
  }

  addPlayer(ws: WebSocket, name: string, requestedTeam?: TeamId): PlayerConn {
    const team = this.pickTeam(requestedTeam);
    const player: PlayerConn = {
      id: this.nextId++,
      ws,
      name: name.slice(0, 24) || 'Player',
      team,
      pos: this.spawnPos(team),
      aim: 0,
      hp: MAX_HP,
      alive: true,
      buttons: 0,
      lastSeq: 0,
      inputQueue: [],
    };
    this.players.set(player.id, player);
    ws.send(encode({ t: 'welcome', id: player.id, map: this.map.def.name, tick: this.tick }));
    this.broadcastRoster();
    return player;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
    this.broadcastRoster();
  }

  handleInput(id: number, msg: InputMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.s <= p.lastSeq) return; // stale/duplicate
    if (p.inputQueue.length >= MAX_QUEUED_INPUTS) p.inputQueue.shift();
    p.inputQueue.push(msg);
  }

  private step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      // Apply every queued input with a fixed dt each — clients that hiccup
      // catch up smoothly, and one input == one tick keeps prediction exact.
      const queue = p.inputQueue;
      p.inputQueue = [];
      for (const input of queue) {
        p.lastSeq = input.s;
        p.buttons = input.b;
        p.aim = input.a;
        if (p.alive) {
          p.pos = stepMovement(p.pos, buttonsToMove(input.b), 1, this.map, TICK_DT);
        }
      }
    }

    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  private snapPlayers(): PlayerSnap[] {
    const snaps: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.alive) flags |= PFLAG.ALIVE;
      snaps.push([p.id, Math.round(p.pos.x * 10) / 10, Math.round(p.pos.y * 10) / 10, Math.round(p.aim * 1000) / 1000, p.hp, flags]);
    }
    return snaps;
  }

  private broadcastSnapshot(): void {
    const players = this.snapPlayers();
    for (const p of this.players.values()) {
      p.ws?.send(encode({ t: 's', k: this.tick, a: p.lastSeq, p: players }));
    }
  }

  broadcastRoster(): void {
    const roster: RosterEntry[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
    }));
    for (const p of this.players.values()) {
      p.ws?.send(encode({ t: 'roster', players: roster }));
    }
  }
}
