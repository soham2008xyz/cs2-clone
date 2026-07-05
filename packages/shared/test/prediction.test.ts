import { describe, expect, it } from 'vitest';
import { BTN, TICK_DT, TILE_SIZE } from '../src/index.js';
import { buttonsToMove } from '../src/sim/input.js';
import { compileMap } from '../src/map/compile.js';
import { MapBuilder } from '../src/map/builder.js';
import { stepMovement } from '../src/sim/movement.js';
import type { Vec2 } from '../src/math.js';

function arena() {
  const b = new MapBuilder(20, 20);
  b.carve(1, 1, 18, 18);
  b.wall(10, 5, 1, 10); // a wall to slide against
  b.spawn('T', 3, 3);
  b.spawn('CT', 16, 16);
  return compileMap(b.build('arena', 'Arena'));
}

/**
 * The invariant client-side prediction depends on: applying the same input
 * sequence from the same start state yields bit-identical positions on the
 * "client" and the "server", including collisions and wall slides.
 */
describe('prediction determinism', () => {
  it('client replay matches server simulation exactly', () => {
    const map = arena();
    const inputs: number[] = [];
    // a wiggly path that hits the wall and slides along it
    for (let i = 0; i < 120; i++) inputs.push(BTN.RIGHT | (i % 3 === 0 ? BTN.DOWN : 0));
    for (let i = 0; i < 60; i++) inputs.push(BTN.RIGHT | BTN.UP | (i % 2 ? BTN.WALK : 0));

    const start: Vec2 = { x: 3.5 * TILE_SIZE, y: 3.5 * TILE_SIZE };
    let client = { ...start };
    let server = { ...start };
    for (const b of inputs) {
      client = stepMovement(client, buttonsToMove(b), 1, map, TICK_DT);
    }
    for (const b of inputs) {
      server = stepMovement(server, buttonsToMove(b), 1, map, TICK_DT);
    }
    expect(client.x).toBe(server.x);
    expect(client.y).toBe(server.y);
  });

  it('reconciliation from a mid-stream server state converges to the predicted state', () => {
    const map = arena();
    const inputs: number[] = Array.from({ length: 100 }, (_, i) => (i < 50 ? BTN.RIGHT : BTN.RIGHT | BTN.DOWN));
    const start: Vec2 = { x: 3.5 * TILE_SIZE, y: 3.5 * TILE_SIZE };

    // client predicts all 100
    let predicted = { ...start };
    for (const b of inputs) predicted = stepMovement(predicted, buttonsToMove(b), 1, map, TICK_DT);

    // server has only processed the first 60 (ack=60); client rewinds to the
    // server state and replays inputs 61..100 — must land exactly on `predicted`
    let serverState = { ...start };
    for (const b of inputs.slice(0, 60)) serverState = stepMovement(serverState, buttonsToMove(b), 1, map, TICK_DT);
    let reconciled = { ...serverState };
    for (const b of inputs.slice(60)) reconciled = stepMovement(reconciled, buttonsToMove(b), 1, map, TICK_DT);

    expect(reconciled.x).toBe(predicted.x);
    expect(reconciled.y).toBe(predicted.y);
  });
});
