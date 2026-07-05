import { BTN } from '../net/protocol.js';
import type { MoveButtons } from './movement.js';

export function buttonsToMove(b: number): MoveButtons {
  return {
    up: (b & BTN.UP) !== 0,
    down: (b & BTN.DOWN) !== 0,
    left: (b & BTN.LEFT) !== 0,
    right: (b & BTN.RIGHT) !== 0,
    walk: (b & BTN.WALK) !== 0,
  };
}
