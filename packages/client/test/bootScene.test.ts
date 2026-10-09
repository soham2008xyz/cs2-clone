import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class { constructor(public key: string) {} } } }));
const textures = vi.hoisted(() => ({
  generateTileset: vi.fn(),
  generateObjectTextures: vi.fn(),
  generatePlayerTexture: vi.fn(),
  TEAM_COLORS: { T: 1, CT: 2 },
}));
vi.mock('../src/textures.js', () => textures);

const { BootScene, playerTexture } = await import('../src/scenes/BootScene.js');

describe('BootScene', () => {
  it('is registered as "Boot"', () => {
    expect((new BootScene() as unknown as { key: string }).key).toBe('Boot');
  });

  it('generates the procedural baseline, then queues the optional sprites and tolerates load errors', () => {
    const scene = new BootScene() as unknown as {
      load: { on: ReturnType<typeof vi.fn>; image: ReturnType<typeof vi.fn> };
      preload(): void;
    };
    scene.load = { on: vi.fn(), image: vi.fn() };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scene.preload();

    expect(textures.generateTileset).toHaveBeenCalledWith(scene);
    expect(textures.generateObjectTextures).toHaveBeenCalledWith(scene);
    expect(textures.generatePlayerTexture).toHaveBeenCalledWith(scene, 'player_T_fallback', 1);
    expect(textures.generatePlayerTexture).toHaveBeenCalledWith(scene, 'player_CT_fallback', 2);
    expect(scene.load.image.mock.calls.map((c) => c[0])).toEqual(['kenney_T', 'kenney_CT', 'muzzle', 'smokepuff', 'flame', 'glow']);

    const [event, onError] = scene.load.on.mock.calls[0];
    expect(event).toBe('loaderror');
    onError({ key: 'muzzle' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('muzzle'));
    warn.mockRestore();
  });

  it('starts the game scene once created', () => {
    const scene = new BootScene() as unknown as { scene: { start: ReturnType<typeof vi.fn> }; create(): void };
    scene.scene = { start: vi.fn() };
    scene.create();
    expect(scene.scene.start).toHaveBeenCalledWith('Game');
  });
});

describe('playerTexture', () => {
  const sceneWith = (...keys: string[]) => ({ textures: { exists: (k: string) => keys.includes(k) } }) as never;

  it('prefers the Kenney sprite when it loaded', () => {
    expect(playerTexture(sceneWith('kenney_CT'), 'CT')).toBe('kenney_CT');
  });

  it('falls back to the procedural marker', () => {
    expect(playerTexture(sceneWith(), 'T')).toBe('player_T_fallback');
    expect(playerTexture(sceneWith('kenney_CT'), 'T')).toBe('player_T_fallback');
  });
});
