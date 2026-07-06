import { TILE_SIZE } from '../constants.js';
import type { Vec2 } from '../math.js';
import { CH, type CompiledMap, type MapDef, type TeamId } from './types.js';

export function compileMap(def: MapDef): CompiledMap {
  const height = def.grid.length;
  const width = def.grid[0].length;
  for (const row of def.grid) {
    if (row.length !== width) {
      throw new Error(`map ${def.name}: ragged grid row (expected ${width}, got ${row.length})`);
    }
  }

  const solid = new Uint8Array(width * height);
  const spawns: Record<TeamId, Vec2[]> = { T: [], CT: [] };
  const siteTiles = new Map<number, 'A' | 'B'>();
  const siteAcc = { A: { x: 0, y: 0, n: 0 }, B: { x: 0, y: 0, n: 0 } };

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const ch = def.grid[ty][tx];
      const i = ty * width + tx;
      if (ch === CH.WALL || ch === CH.BOX) solid[i] = 1;
      const center: Vec2 = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
      if (ch === CH.T_SPAWN) spawns.T.push(center);
      if (ch === CH.CT_SPAWN) spawns.CT.push(center);
      if (ch === CH.SITE_A || ch === CH.SITE_B) {
        const site = ch === CH.SITE_A ? 'A' : 'B';
        siteTiles.set(i, site);
        siteAcc[site].x += center.x;
        siteAcc[site].y += center.y;
        siteAcc[site].n++;
      }
    }
  }

  if (spawns.T.length === 0 || spawns.CT.length === 0) {
    throw new Error(`map ${def.name}: missing spawns for one or both teams`);
  }

  const isSolid = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true; // out of bounds is solid
    return solid[ty * width + tx] === 1;
  };

  const siteCenters = {
    A: { x: siteAcc.A.x / Math.max(1, siteAcc.A.n), y: siteAcc.A.y / Math.max(1, siteAcc.A.n) },
    B: { x: siteAcc.B.x / Math.max(1, siteAcc.B.n), y: siteAcc.B.y / Math.max(1, siteAcc.B.n) },
  };

  return {
    def,
    width,
    height,
    widthPx: width * TILE_SIZE,
    heightPx: height * TILE_SIZE,
    solid,
    isSolid,
    isSolidAt: (x, y) => isSolid(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)),
    charAt: (tx, ty) => (tx < 0 || ty < 0 || tx >= width || ty >= height ? CH.WALL : def.grid[ty][tx]),
    spawns,
    siteAt: (x, y) => siteTiles.get(Math.floor(y / TILE_SIZE) * width + Math.floor(x / TILE_SIZE)) ?? null,
    siteCenters,
    buyzoneAt: (x, y) => {
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      for (const z of def.buyzones ?? []) {
        if (tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h) return z.team;
      }
      return null;
    },
    utilitySpots: (def.utilitySpots ?? []).map((s) => ({
      kind: s.kind,
      site: s.site,
      pos: { x: (s.tx + 0.5) * TILE_SIZE, y: (s.ty + 0.5) * TILE_SIZE },
    })),
  };
}
