import { describe, expect, it, vi } from 'vitest';
import { CH, getMap, TILE_SIZE, type CompiledMap } from '@cs2d/shared';
import { fakeFactory, fakeObject, type FakeObject } from './phaserFakes.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

const { renderMap } = await import('../src/render/mapRender.js');
const { TILE_INDEX } = await import('../src/textures.js');

function render(map: CompiledMap) {
  const { add, created } = fakeFactory();
  const layer = fakeObject();
  const tileset = fakeObject();
  let tilemapConfig: { data: number[][]; tileWidth: number; tileHeight: number } | undefined;
  const tilemap = fakeObject({
    addTilesetImage: (...a: unknown[]) => {
      tilemap.calls.push({ method: 'addTilesetImage', args: a });
      return tileset;
    },
    createLayer: (...a: unknown[]) => {
      tilemap.calls.push({ method: 'createLayer', args: a });
      return layer;
    },
  });
  const scene = {
    add,
    make: {
      tilemap: (cfg: typeof tilemapConfig) => {
        tilemapConfig = cfg;
        return tilemap;
      },
    },
  };
  renderMap(scene as never, map);
  return { tilemap, tileset, tilemapConfig: tilemapConfig!, texts: created.filter((c) => c.factory === 'text') };
}

const label = (t: FakeObject): unknown => (t.args as unknown[])[2];

describe('renderMap', () => {
  it('builds a tile grid matching the compiled map and registers the tileset', () => {
    const map = getMap('testarena');
    const { tilemap, tileset, tilemapConfig } = render(map);
    expect(tilemapConfig.data).toHaveLength(map.height);
    expect(tilemapConfig.data[0]).toHaveLength(map.width);
    expect(tilemapConfig.tileWidth).toBe(TILE_SIZE);
    expect(tilemap.calls.find((c) => c.method === 'addTilesetImage')?.args).toEqual(['tiles', 'tiles', TILE_SIZE, TILE_SIZE, 0, 0]);
    expect(tilemap.calls.find((c) => c.method === 'createLayer')?.args).toEqual([0, tileset, 0, 0]);
  });

  it('maps each map character to its tile (spawns render as floor, unknowns fall back to floor)', () => {
    const map = getMap('dust2');
    const { tilemapConfig } = render(map);
    const seen = new Map<string, Set<number>>();
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const ch = map.charAt(tx, ty);
        seen.set(ch, (seen.get(ch) ?? new Set()).add(tilemapConfig.data[ty][tx]));
      }
    }
    expect([...seen.get(CH.WALL)!]).toEqual([TILE_INDEX.WALL]);
    for (const spawn of [CH.T_SPAWN, CH.CT_SPAWN]) if (seen.has(spawn)) expect([...seen.get(spawn)!]).toEqual([TILE_INDEX.FLOOR]);
    for (const set of seen.values()) for (const idx of set) expect(Object.values(TILE_INDEX)).toContain(idx);
  });

  it('adds a letter per bombsite and a faint label per callout', () => {
    const map = getMap('dust2');
    const { texts } = render(map);
    const letters = texts.filter((t) => label(t) === 'A' || label(t) === 'B');
    expect(letters.map((t) => String(label(t))).sort((a, b) => a.localeCompare(b))).toEqual(['A', 'B']);
    const callouts = texts.filter((t) => !['A', 'B'].includes(label(t) as string));
    expect(callouts).toHaveLength(map.def.callouts.length);
    expect(label(callouts[0])).toBe(map.def.callouts[0].name.toUpperCase());
  });

  it('skips a bombsite the map does not have', () => {
    const map = getMap('dust2');
    const noB = { ...map, siteCenters: { A: map.siteCenters.A, B: undefined } } as unknown as CompiledMap;
    const { texts } = render(noB);
    expect(texts.some((t) => label(t) === 'B')).toBe(false);
    expect(texts.some((t) => label(t) === 'A')).toBe(true);
  });
});
