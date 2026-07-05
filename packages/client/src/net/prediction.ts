import {
  buttonsToMove,
  stepMovement,
  TICK_DT,
  type CompiledMap,
  type InputMsg,
  type Vec2,
} from '@cs2d/shared';

interface PendingInput {
  input: InputMsg;
  mobility: number;
}

/**
 * Client-side prediction: applies local inputs immediately using the same
 * shared stepMovement() the server runs, then reconciles against
 * authoritative snapshots by replaying unacknowledged inputs.
 */
export class Predictor {
  pos: Vec2 = { x: 0, y: 0 };
  seq = 0;
  private pending: PendingInput[] = [];

  constructor(private map: CompiledMap) {}

  buildInput(buttons: number, aim: number, lastServerTick: number, switchSlot?: number): InputMsg {
    const msg: InputMsg = { t: 'i', s: ++this.seq, b: buttons, a: aim, k: lastServerTick };
    if (switchSlot) msg.w = switchSlot;
    return msg;
  }

  applyLocal(input: InputMsg, alive: boolean, mobility: number): void {
    if (alive) {
      this.pos = stepMovement(this.pos, buttonsToMove(input.b), mobility, this.map, TICK_DT);
    }
    this.pending.push({ input, mobility });
    if (this.pending.length > 240) this.pending.shift(); // 4s safety cap
  }

  /** Reset to the server's authoritative state, replay unacked inputs. */
  reconcile(serverPos: Vec2, ackSeq: number, alive: boolean): void {
    this.pending = this.pending.filter((p) => p.input.s > ackSeq);
    this.pos = { x: serverPos.x, y: serverPos.y };
    if (!alive) {
      this.pending = [];
      return;
    }
    for (const { input, mobility } of this.pending) {
      this.pos = stepMovement(this.pos, buttonsToMove(input.b), mobility, this.map, TICK_DT);
    }
  }
}
