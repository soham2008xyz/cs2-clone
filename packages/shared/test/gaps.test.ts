import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, TILE_SIZE } from '../src/constants.js';
import { MapBuilder } from '../src/map/builder.js';
import { compileMap } from '../src/map/compile.js';
import { getMap } from '../src/map/registry.js';
import type { MapDef } from '../src/map/types.js';
import { angleDiff } from '../src/math.js';
import { isOvertimeStart } from '../src/sim/match.js';
import { stepMovement } from '../src/sim/movement.js';
import { canSeeBody, hasLineOfSight, SEE_RANGE } from '../src/sim/vision.js';

const px = (tile: number): number => (tile + 0.5) * TILE_SIZE;

/** 12×6 hall with a solid pillar splitting the middle. */
function hall() {
  const b = new MapBuilder(12, 6);
  b.carve(1, 1, 10, 4);
  b.wall(5, 1, 1, 3); // pillar with a gap only along the bottom row
  b.spawn('T', 1, 1);
  b.spawn('CT', 10, 4);
  return compileMap(b.build('hall', 'Hall'));
}

describe('canSeeBody', () => {
  const map = hall();

  it('sees a body in the open', () => {
    expect(canSeeBody([{ x: px(1), y: px(2) }], { x: px(3), y: px(2) }, map)).toBe(true);
  });

  it('sees a body standing exactly on the vantage', () => {
    expect(canSeeBody([{ x: px(1), y: px(2) }], { x: px(1), y: px(2) }, map)).toBe(true);
  });

  it('cannot see through a wall', () => {
    expect(canSeeBody([{ x: px(2), y: px(2) }], { x: px(8), y: px(2) }, map)).toBe(false);
  });

  it('cannot see a body beyond vision range', () => {
    const far = { x: px(1) + SEE_RANGE + 10, y: px(2) };
    expect(canSeeBody([{ x: px(1), y: px(2) }], far, map)).toBe(false);
  });

  it('sees a body whose centre is hidden but whose edge pokes past a corner', () => {
    // vantage left of the pillar, target just below the pillar's bottom edge so only a flank ray clears the corner
    const pillarBottom = 4 * TILE_SIZE;
    const vantage = { x: px(3), y: pillarBottom - 2 };
    const centreBlocked = { x: px(7), y: pillarBottom - 2 };
    expect(hasLineOfSight(vantage, centreBlocked, map)).toBe(false);
    const edgeVisible = { x: px(7), y: pillarBottom + PLAYER_RADIUS - 1 };
    expect(canSeeBody([vantage], edgeVisible, map)).toBe(true);
  });

  it('succeeds if any one of several vantages sees the body', () => {
    const target = { x: px(8), y: px(2) };
    expect(canSeeBody([{ x: px(2), y: px(2) }, { x: px(9), y: px(2) }], target, map)).toBe(true);
    expect(canSeeBody([], target, map)).toBe(false);
  });

  it('is blocked by smoke between the two', () => {
    const open = hall();
    const smoke = [{ pos: { x: px(3), y: px(2) }, radius: 40 }];
    expect(canSeeBody([{ x: px(1), y: px(2) }], { x: px(5) - 80, y: px(2) }, open, smoke)).toBe(false);
  });
});

describe('hasLineOfSight', () => {
  const map = hall();
  it('respects maxDist and treats a zero-length ray as visible', () => {
    expect(hasLineOfSight({ x: px(1), y: px(2) }, { x: px(4), y: px(2) }, map, [], 10)).toBe(false);
    expect(hasLineOfSight({ x: px(1), y: px(2) }, { x: px(1), y: px(2) }, map)).toBe(true);
  });
});

describe('overtime', () => {
  it('isOvertimeStart is false in regulation, true at the first OT round and every full OT cycle after', () => {
    expect(isOvertimeStart(24)).toBe(false);
    expect(isOvertimeStart(25)).toBe(true);
    expect(isOvertimeStart(26)).toBe(false);
    expect(isOvertimeStart(31)).toBe(true);
    expect(isOvertimeStart(28)).toBe(false); // second OT half, not a fresh overtime
  });
});

describe('map compilation errors', () => {
  const base = (over: Partial<MapDef>): MapDef => ({ name: 'bad', displayName: 'Bad', grid: ['####', '#TC#', '####'], callouts: [], ...over });

  it('rejects ragged grids', () => {
    expect(() => compileMap(base({ grid: ['####', '#T#', '####'] }))).toThrow(/ragged/);
  });

  it('rejects maps missing a team spawn', () => {
    expect(() => compileMap(base({ grid: ['####', '#T.#', '####'] }))).toThrow(/missing spawns/);
  });

  it('treats everything outside the grid as wall', () => {
    const m = hall();
    expect(m.charAt(-1, 0)).toBe('#');
    expect(m.charAt(0, 99)).toBe('#');
    expect(m.isSolid(-3, -3)).toBe(true);
  });

  it('answers site and buy-zone queries with null where there are none', () => {
    const m = hall();
    expect(m.siteAt(px(2), px(2))).toBeNull();
    expect(m.buyzoneAt(px(2), px(2))).toBeNull();
  });

  it('resolves buy zones by tile rectangle', () => {
    const b = new MapBuilder(8, 8);
    b.carve(1, 1, 6, 6).spawn('T', 1, 1).spawn('CT', 6, 6).buyzone('T', 1, 1, 2, 2);
    const m = compileMap(b.build('z', 'Z'));
    expect(m.buyzoneAt(px(1), px(1))).toBe('T');
    expect(m.buyzoneAt(px(5), px(5))).toBeNull();
  });

  it('getMap rejects an unknown name, and returns the same compiled instance each time', () => {
    expect(() => getMap('nope')).toThrow(/unknown map/);
    expect(getMap('dust2')).toBe(getMap('dust2'));
  });

  it('MapBuilder refuses to draw outside its bounds', () => {
    expect(() => new MapBuilder(4, 4).carve(3, 3, 2, 2)).toThrow(/out of bounds/);
    expect(() => new MapBuilder(4, 4).spawn('T', -1, 0)).toThrow(/out of bounds/);
  });
});

describe('movement and angles', () => {
  const map = hall();
  const none = { up: false, down: false, left: false, right: false, walk: false };

  it('returns the same position when no direction is held', () => {
    const pos = { x: px(2), y: px(2) };
    expect(stepMovement(pos, none, 1, map, 1 / 60)).toBe(pos);
  });

  it('opposing keys cancel out', () => {
    const pos = { x: px(2), y: px(2) };
    expect(stepMovement(pos, { ...none, left: true, right: true, up: true, down: true }, 1, map, 1 / 60)).toBe(pos);
  });

  it('moves left and up', () => {
    const pos = { x: px(3), y: px(3) };
    const next = stepMovement(pos, { ...none, left: true, up: true }, 1, map, 1 / 60);
    expect(next.x).toBeLessThan(pos.x);
    expect(next.y).toBeLessThan(pos.y);
  });

  it('angleDiff takes the short way round the circle, whichever direction', () => {
    expect(angleDiff(0, Math.PI * 1.9)).toBeCloseTo(Math.PI * 0.1);
    expect(angleDiff(Math.PI * 1.9, 0)).toBeCloseTo(Math.PI * 0.1);
    expect(angleDiff(-Math.PI * 0.9, Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
    expect(angleDiff(1, 1)).toBe(0);
  });
});
