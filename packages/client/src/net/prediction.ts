import {
  buttonsToMove,
  stepMovement,
  TICK_DT,
  type CompiledMap,
  type InputMsg,
  type Vec2,
} from '@cs2d/shared';

/**
 * Client-side prediction: applies local inputs immediately using the same
 * shared stepMovement() the server runs, then reconciles against
 * authoritative snapshots by replaying unacknowledged inputs.
 */
export class Predictor {
  pos: Vec2 = { x: 0, y: 0 };
  seq = 0;
  private pending: InputMsg[] = [];

  constructor(private map: CompiledMap) {}

  buildInput(buttons: number, aim: number): InputMsg {
    return { t: 'i', s: ++this.seq, b: buttons, a: aim };
  }

  applyLocal(input: InputMsg, alive: boolean): void {
    if (alive) {
      this.pos = stepMovement(this.pos, buttonsToMove(input.b), 1, this.map, TICK_DT);
    }
    this.pending.push(input);
    if (this.pending.length > 240) this.pending.shift(); // 4s safety cap
  }

  /** Reset to the server's authoritative state, replay unacked inputs. */
  reconcile(serverPos: Vec2, ackSeq: number, alive: boolean): void {
    this.pending = this.pending.filter((i) => i.s > ackSeq);
    this.pos = { x: serverPos.x, y: serverPos.y };
    if (!alive) {
      this.pending = [];
      return;
    }
    for (const input of this.pending) {
      this.pos = stepMovement(this.pos, buttonsToMove(input.b), 1, this.map, TICK_DT);
    }
  }
}
