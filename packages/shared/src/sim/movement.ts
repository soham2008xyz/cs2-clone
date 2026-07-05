import { PLAYER_RADIUS, RUN_SPEED, WALK_SPEED_MULT } from '../constants.js';
import type { Vec2 } from '../math.js';
import type { CompiledMap } from '../map/types.js';
import { moveCircle } from './collision.js';

export interface MoveButtons {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  walk: boolean;
}

/**
 * Pure movement step shared by server simulation and client prediction.
 * `speedMult` comes from the equipped weapon's mobility.
 */
export function stepMovement(
  pos: Vec2,
  buttons: MoveButtons,
  speedMult: number,
  map: CompiledMap,
  dt: number,
): Vec2 {
  let dx = (buttons.right ? 1 : 0) - (buttons.left ? 1 : 0);
  let dy = (buttons.down ? 1 : 0) - (buttons.up ? 1 : 0);
  if (dx === 0 && dy === 0) return pos;

  const invLen = 1 / Math.hypot(dx, dy);
  dx *= invLen;
  dy *= invLen;

  const speed = RUN_SPEED * speedMult * (buttons.walk ? WALK_SPEED_MULT : 1);
  return moveCircle(pos, { x: dx * speed * dt, y: dy * speed * dt }, PLAYER_RADIUS, map);
}
