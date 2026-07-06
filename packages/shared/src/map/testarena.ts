import { MapBuilder } from './builder.js';
import type { MapDef } from './types.js';

/**
 * Tiny open arena for integration tests: teams spawn with direct LOS,
 * bomb site A in the middle. Not listed in real map rotation UIs.
 */
function buildTestArena(): MapDef {
  const b = new MapBuilder(24, 12);
  b.carve(1, 1, 22, 10);
  b.site('A', 10, 4, 4, 4);
  for (let i = 0; i < 5; i++) {
    b.spawn('T', 3, 3 + i);
    b.spawn('CT', 20, 3 + i);
  }
  b.callout('Arena', 12, 6);
  return b.build('testarena', 'Test Arena');
}

export const TEST_ARENA: MapDef = buildTestArena();
