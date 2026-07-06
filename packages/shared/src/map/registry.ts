import { compileMap } from './compile.js';
import { DUST2 } from './dust2.js';
import { TEST_ARENA } from './testarena.js';
import type { CompiledMap, MapDef } from './types.js';

const defs = new Map<string, MapDef>();
const compiled = new Map<string, CompiledMap>();

export function registerMap(def: MapDef): void {
  defs.set(def.name, def);
}

export function getMap(name: string): CompiledMap {
  let c = compiled.get(name);
  if (!c) {
    const def = defs.get(name);
    if (!def) throw new Error(`unknown map: ${name}`);
    c = compileMap(def);
    compiled.set(name, c);
  }
  return c;
}

export function listMaps(): string[] {
  return [...defs.keys()];
}

registerMap(DUST2);
registerMap(TEST_ARENA);
