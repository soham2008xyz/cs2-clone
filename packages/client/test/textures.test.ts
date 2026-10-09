// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE_SIZE } from '@cs2d/shared';
import { fakeObject, methodsCalled, type FakeObject } from './phaserFakes.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

const { generateObjectTextures, generatePlayerTexture, generateTileset, TEAM_COLORS, TILE_INDEX } = await import('../src/textures.js');

/** Scene stand-in whose texture manager remembers what was registered. */
function fakeScene(existing: string[] = []) {
  const keys = new Set(existing);
  const graphics: FakeObject[] = [];
  const scene = {
    textures: {
      exists: (k: string) => keys.has(k),
      addCanvas: vi.fn((k: string) => keys.add(k)),
    },
    make: {
      graphics: vi.fn(() => {
        const g = fakeObject();
        graphics.push(g);
        return g;
      }),
    },
  };
  return { scene: scene as unknown as Parameters<typeof generateTileset>[0], addCanvas: scene.textures.addCanvas, graphics, keys };
}

/** Recording 2D context (jsdom has no canvas implementation). */
function stubCanvas() {
  const fills: string[] = [];
  const ops: string[] = [];
  const ctx = new Proxy(
    {} as Record<string, unknown>,
    {
      get: (_t, key: string) => (...args: unknown[]) => {
        ops.push(key);
        void args;
      },
      set: (_t, key: string, value) => {
        if (key === 'fillStyle') fills.push(String(value));
        return true;
      },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { fills, ops };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('generateTileset', () => {
  it('paints one tile per kind into a single canvas and registers it as "tiles"', () => {
    const { fills, ops } = stubCanvas();
    const { scene, addCanvas } = fakeScene();
    generateTileset(scene);
    expect(addCanvas).toHaveBeenCalledTimes(1);
    const [key, canvas] = addCanvas.mock.calls[0] as unknown as [string, HTMLCanvasElement];
    expect(key).toBe('tiles');
    expect(canvas.width).toBe(TILE_SIZE * 5);
    expect(canvas.height).toBe(TILE_SIZE);
    expect(Object.keys(TILE_INDEX)).toHaveLength(5);
    expect(fills).toContain('#6e5f43'); // wall
    expect(fills).toContain('#8a6f43'); // crate
    expect(ops).toContain('stroke'); // crate cross
  });

  it('is idempotent: an existing tileset is left alone', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { scene, addCanvas } = fakeScene(['tiles']);
    generateTileset(scene);
    expect(addCanvas).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('generatePlayerTexture', () => {
  it('draws a team-colored marker, bakes it into a 48px texture and frees the graphics', () => {
    const { scene, graphics } = fakeScene();
    generatePlayerTexture(scene, 'player_T_fallback', TEAM_COLORS.T);
    expect(graphics).toHaveLength(1);
    const g = graphics[0];
    expect(g.calls.find((c) => c.method === 'fillStyle' && c.args[0] === TEAM_COLORS.T)).toBeDefined();
    expect(g.calls.find((c) => c.method === 'generateTexture')?.args).toEqual(['player_T_fallback', 48, 48]);
    expect(methodsCalled(g).at(-1)).toBe('destroy');
  });

  it('skips a texture that already exists', () => {
    const { scene, graphics } = fakeScene(['player_CT_fallback']);
    generatePlayerTexture(scene, 'player_CT_fallback', TEAM_COLORS.CT);
    expect(graphics).toHaveLength(0);
  });
});

describe('generateObjectTextures', () => {
  it('generates the bomb and ground-item textures', () => {
    const { scene, graphics } = fakeScene();
    generateObjectTextures(scene);
    const baked = graphics.map((g) => g.calls.find((c) => c.method === 'generateTexture')?.args[0]);
    expect(baked).toEqual(['bomb', 'grounditem']);
    expect(graphics.every((g) => methodsCalled(g).at(-1) === 'destroy')).toBe(true);
  });

  it('only generates what is missing', () => {
    const { scene, graphics } = fakeScene(['bomb']);
    generateObjectTextures(scene);
    expect(graphics).toHaveLength(1);
    expect(graphics[0].calls.find((c) => c.method === 'generateTexture')?.args[0]).toBe('grounditem');
  });

  it('does nothing when both exist', () => {
    const { scene, graphics } = fakeScene(['bomb', 'grounditem']);
    generateObjectTextures(scene);
    expect(graphics).toHaveLength(0);
  });
});
