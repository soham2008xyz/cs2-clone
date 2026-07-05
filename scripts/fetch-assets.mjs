// Downloads Kenney CC0 asset packs (top-down shooter + particle pack) and
// extracts the subset the game uses into packages/client/public/assets/.
// Safe to re-run; skips downloads that already exist. The game runs fine
// without these (procedural fallbacks) — this just upgrades the visuals.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.assets-tmp');
const out = join(root, 'packages/client/public/assets');
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });

const PACKS = [
  {
    name: 'topdown',
    url: 'https://kenney.nl/media/pages/assets/top-down-shooter/230204340a-1677694684/kenney_top-down-shooter.zip',
  },
  {
    name: 'particles',
    url: 'https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip',
  },
];

for (const pack of PACKS) {
  const zipPath = join(tmp, `${pack.name}.zip`);
  const extractDir = join(tmp, pack.name);
  if (!existsSync(zipPath)) {
    console.log(`downloading ${pack.name}...`);
    const res = await fetch(pack.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${pack.name}: HTTP ${res.status}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  if (!existsSync(extractDir)) {
    execFileSync('unzip', ['-oq', zipPath, '-d', extractDir]);
  }
  console.log(`${pack.name} ready`);
}

// ── copy the subset we use, with stable flat names ──
const picks = [
  // [source within extracted pack, destination name]
  ['topdown/PNG/Man Brown/manBrown_gun.png', 'man_brown_gun.png'],
  ['topdown/PNG/Soldier 1/soldier1_gun.png', 'soldier1_gun.png'],
  ['topdown/PNG/Man Brown/manBrown_reload.png', 'man_brown_reload.png'],
  ['topdown/PNG/Soldier 1/soldier1_reload.png', 'soldier1_reload.png'],
  ['particles/PNG (Transparent)/smoke_08.png', 'smoke.png'],
  ['particles/PNG (Transparent)/flame_01.png', 'flame.png'],
  ['particles/PNG (Transparent)/muzzle_01.png', 'muzzle.png'],
  ['particles/PNG (Transparent)/circle_05.png', 'glow.png'],
];

let copied = 0;
for (const [src, dst] of picks) {
  const from = join(tmp, src);
  if (existsSync(from)) {
    copyFileSync(from, join(out, dst));
    copied++;
  } else {
    console.warn(`missing in pack: ${src}`);
  }
}
console.log(`copied ${copied}/${picks.length} sprites to packages/client/public/assets/`);
