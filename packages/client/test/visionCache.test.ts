import { describe, expect, it } from 'vitest';
import { compileMap, MapBuilder, TILE_SIZE } from '@cs2d/shared';
import { VisionCache } from '../src/render/visionCache.js';

const b = new MapBuilder(20, 20);
b.carve(1, 1, 18, 18);
b.spawn('T', 2, 2);
b.spawn('CT', 17, 17);
const map = compileMap(b.build('room', 'Room'));
const origin = { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE };

describe('VisionCache', () => {
  it('recomputes once, then reuses the polygon while nothing changes', () => {
    const c = new VisionCache();
    const first = c.update(origin, map, []);
    expect(first.changed).toBe(true);
    const second = c.update({ x: origin.x + 0.4, y: origin.y }, map, []);
    expect(second.changed).toBe(false);
    expect(second.poly).toBe(first.poly);
  });

  it('recomputes when the origin moves about a pixel or more', () => {
    const c = new VisionCache();
    c.update(origin, map, []);
    expect(c.update({ x: origin.x + 2, y: origin.y }, map, []).changed).toBe(true);
  });

  it('recomputes when smokes appear, move or change radius', () => {
    const c = new VisionCache();
    const smoke = { pos: { x: origin.x + 100, y: origin.y }, radius: 50 };
    c.update(origin, map, []);
    expect(c.update(origin, map, [smoke]).changed).toBe(true);
    expect(c.update(origin, map, [{ ...smoke }]).changed).toBe(false);
    expect(c.update(origin, map, [{ ...smoke, radius: 60 }]).changed).toBe(true);
    expect(c.update(origin, map, [{ pos: { x: smoke.pos.x + 5, y: smoke.pos.y }, radius: 60 }]).changed).toBe(true);
  });

  it('matches a fresh polygon after reuse', () => {
    const c = new VisionCache();
    const smoke = { pos: { x: origin.x + 100, y: origin.y }, radius: 50 };
    c.update(origin, map, []);
    const reused = c.update({ x: origin.x + 30, y: origin.y + 10 }, map, [smoke]).poly;
    const fresh = new VisionCache().update({ x: origin.x + 30, y: origin.y + 10 }, map, [smoke]).poly;
    expect(reused).toEqual(fresh);
  });
});
