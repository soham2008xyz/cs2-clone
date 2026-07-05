import { CH, type Callout, type MapDef } from './types.js';

/**
 * Authoring tool: start from all-walls, carve out rooms and corridors, then
 * decorate. Produces a plain grid-of-chars MapDef, so maps stay data.
 */
export class MapBuilder {
  private cells: string[][];
  private callouts: Callout[] = [];

  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.cells = Array.from({ length: height }, () => Array(width).fill(CH.WALL));
  }

  private set(x: number, y: number, ch: string): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new Error(`out of bounds: ${x},${y}`);
    }
    this.cells[y][x] = ch;
  }

  /** Carve a walkable rectangle (inclusive of w×h tiles starting at x,y). */
  carve(x: number, y: number, w: number, h: number, ch: string = CH.FLOOR): this {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) this.set(i, j, ch);
    }
    return this;
  }

  /** Fill a rectangle with walls (e.g. to re-split a carved area). */
  wall(x: number, y: number, w = 1, h = 1): this {
    return this.carve(x, y, w, h, CH.WALL);
  }

  /** Place a crate. */
  box(x: number, y: number, w = 1, h = 1): this {
    return this.carve(x, y, w, h, CH.BOX);
  }

  /** Mark plantable bombsite tiles (walkable). */
  site(which: 'A' | 'B', x: number, y: number, w: number, h: number): this {
    return this.carve(x, y, w, h, which === 'A' ? CH.SITE_A : CH.SITE_B);
  }

  spawn(team: 'T' | 'CT', x: number, y: number): this {
    this.set(x, y, team === 'T' ? CH.T_SPAWN : CH.CT_SPAWN);
    return this;
  }

  callout(name: string, tx: number, ty: number): this {
    this.callouts.push({ name, tx, ty });
    return this;
  }

  build(name: string, displayName: string): MapDef {
    return {
      name,
      displayName,
      grid: this.cells.map((row) => row.join('')),
      callouts: this.callouts,
    };
  }
}
