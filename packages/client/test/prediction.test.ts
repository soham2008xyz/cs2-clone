import { describe, expect, it } from 'vitest';
import { BTN, compileMap, MapBuilder, stepMovement, TICK_DT, buttonsToMove, type Vec2 } from '@cs2d/shared';
import { Predictor } from '../src/net/prediction.js';

function arena() {
  const b = new MapBuilder(20, 20);
  b.carve(1, 1, 18, 18);
  b.spawn('T', 3, 3);
  b.spawn('CT', 16, 16);
  return compileMap(b.build('arena', 'Arena'));
}

describe('Predictor.applyLocal', () => {
  it('moves using the same shared stepMovement the server runs', () => {
    const map = arena();
    const predictor = new Predictor(map);
    const input = predictor.buildInput(BTN.RIGHT, 0, 0);
    predictor.applyLocal(input, true, 1);

    const expected: Vec2 = stepMovement({ x: 0, y: 0 }, buttonsToMove(BTN.RIGHT), 1, map, TICK_DT);
    expect(predictor.pos).toEqual(expected);
  });

  it('does not move a dead player', () => {
    const map = arena();
    const predictor = new Predictor(map);
    const input = predictor.buildInput(BTN.RIGHT, 0, 0);
    predictor.applyLocal(input, false, 1);
    expect(predictor.pos).toEqual({ x: 0, y: 0 });
  });
});

describe('Predictor.reconcile', () => {
  it('replays only inputs newer than the acked sequence', () => {
    const map = arena();
    const predictor = new Predictor(map);
    for (let i = 0; i < 5; i++) {
      predictor.applyLocal(predictor.buildInput(BTN.RIGHT, 0, 0), true, 1);
    }
    // predictor.seq is now 5; server acked through seq 3, so only inputs 4 and 5 replay
    const serverPos: Vec2 = { x: 1000, y: 1000 };
    predictor.reconcile(serverPos, 3, true);

    let expected = { ...serverPos };
    for (let i = 0; i < 2; i++) {
      expected = stepMovement(expected, buttonsToMove(BTN.RIGHT), 1, map, TICK_DT);
    }
    expect(predictor.pos).toEqual(expected);
  });

  it('clears pending input history when the player is dead, so a later reconcile has nothing to replay', () => {
    const map = arena();
    const predictor = new Predictor(map);
    for (let i = 0; i < 5; i++) {
      predictor.applyLocal(predictor.buildInput(BTN.RIGHT, 0, 0), true, 1);
    }
    predictor.reconcile({ x: 500, y: 500 }, 0, false); // dead: clears pending regardless of ackSeq

    const nextServerPos: Vec2 = { x: 900, y: 900 };
    predictor.reconcile(nextServerPos, 0, true); // no leftover inputs to replay
    expect(predictor.pos).toEqual(nextServerPos);
  });
});
