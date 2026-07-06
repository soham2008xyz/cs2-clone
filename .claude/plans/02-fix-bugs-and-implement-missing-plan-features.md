# CS2 Clone — Fix Bugs & Implement Missing Plan Features

## Context

An audit of the project against `.claude/plans/2d-top-down-counter-strike-plan.md` found the implementation solid (all 51 unit tests + both integration suites pass) but identified **3 real bugs**, **one entirely missing plan section (audio)**, several dropped features (G-drop, helmet, bot utility/flash-reaction/fire-avoidance/retreat, smoke-on-rest, MapDef buy zones, unused Kenney particles, server-serves-client), and minor CS2-fidelity nits. This plan implements all of them.

**User decisions (locked):**
- **Helmet:** implement with a custom effect — while worn, armor absorbs more (effective `armorPen × 0.85`).
- **Architecture:** do NOT extract Room logic to shared; instead add direct headless `Room` unit tests to close the coverage gap.
- **Audio:** synth-only (ZzFX-style WebAudio), no Kenney audio samples.

**Conventions:** one conventional commit per phase (per global CLAUDE.md), `npm test` + both integration scripts green before each commit.

---

## Phase 1 — Bug fixes + missing test coverage

`fix(combat): utility friendly fire, grenade kill attribution, room lifecycle and economy fidelity`

### 1.1 Utility friendly fire + grenade kill attribution (one root cause)
Files: `packages/server/src/room.ts`, `packages/shared/src/sim/grenades.data.ts`, `packages/shared/src/net/protocol.ts` (no shape change needed), `packages/client/src/scenes/GameScene.ts`, `packages/client/src/scenes/HudScene.ts`

- Add `ownerId: number; ownerTeam: TeamId` to `ActiveNade` and `FireZone` (room.ts:156, 171); capture in `throwGrenade()` and on molotov ignite.
- `detonateNade()` HE case (room.ts:766): filter targets — keep `t.id === ownerId` (self-damage, CS behavior) or `t.team !== ownerTeam`, unless `FRIENDLY_FIRE` is true. Same filter in the fire-tick loop in `updateGrenades()` (room.ts:828).
- Add `killReward: 300` to `GrenadeDef` for he/molotov/incendiary (`grenades.data.ts`).
- Replace `killByEnvironment()` usage for nade deaths with an attributed kill path: credit owner (kills++, clamped killReward), emit `{e:'kill', k: ownerId, v, w: kind}`. If owner left the room, emit with `k: 0`. Bomb-explosion deaths: emit `{e:'kill', k: 0, v, w: 'c4'}` so the killfeed shows them.
- **Client killfeed hardening:** `GameScene.handleEvent` kill case currently calls `getWeapon(ev.w).name` — throws for `'he'`/`'molotov'`/`'c4'`. Add a `weaponDisplayName(id)` helper (WEAPONS → GRENADES → `'c4'` → raw id fallback). `HudScene.onKill`: when killer is world (`k === 0`), render `☠  [C4]  victim` style line.
- Wire the existing `FRIENDLY_FIRE` constant explicitly into the `traceShot()` call in `tryFire()` (room.ts:869) — today it only works because the parameter default happens to match.

### 1.2 Bot-only zombie rooms + creation race
File: `packages/server/src/roomManager.ts` (and `index.ts` unchanged)

- Add `createdAt: number` to the room entry.
- New reap rule: delete when the room has **no human players** (`![...room.players.values()].some(p => p.ws)`) **and** `age > 60s`. This kills bot-only backfill rooms and gives freshly created rooms a join grace window (fixes the POST-then-reap race).

### 1.3 Economy / rules fidelity (all in `packages/server/src/room.ts`)
- **Kit lost on death:** in `startRound()` non-survivor branch (room.ts:611), set `p.hasKit = false` unconditionally.
- **Loss streaks reset at halftime/OT half:** in `startRound()`, when `isPistolRound(n) || isOvertimeHalfStart(n)`, reset `this.streaks = { T: 0, CT: 0 }`.
- **Alive Ts get $0 on time expiry:** in `endRound()`, when `reason === 'time'`, skip the loss bonus for losing-team players who are alive.
- **Bomb blink after defuse:** `defuseBomb()` sets `this.bomb.mode = 'none'`.
- **Molotov stacking:** in the fire loop, collect burned player ids per tick into a `Set` — max one fire tick of damage per player per tick regardless of overlapping zones.
- **M4A4 price** → `3100` (`packages/shared/src/sim/weapons.data.ts:95`).

### 1.4 New tests
- `packages/server/test/room.test.ts` — drive `Room` headlessly (it's constructible without ws; bots already use `ws: null`; advance via `(room as any).step()` or add a small public `stepOnce()` test hook). Cover: post-plant T-elimination does NOT end the round; defuse ends round and clears bomb; HE/molotov don't damage teammates but do damage self/enemies; nade kill emits attributed kill event + pays $300; kit lost on death; streaks reset at round 13; alive-T time-loss pays $0; fire damage doesn't stack.
- `packages/server/test/lagcomp.test.ts` — `LagCompensator`: record N frames, rewind to seen-tick − interp delay, clamping at both ends, `undefined` seen-tick fallback (bots).

---

## Phase 2 — Dropped gameplay features

`feat(gameplay): weapon drop, helmet, map-authored buy zones, physical grenade detonation`

### 2.1 G = drop weapon
- Client (`GameScene.ts`): add `G` to the key map; set `BTN.DROP` when down (respect `chatOpen`).
- Server (`room.ts` input loop): edge-detect DROP via `prevButtons`; drop the **active** slot's weapon (primary or secondary) with existing `dropWeapon()`, clear the slot, switch to remaining gun else knife (slot 3).
- Extend `tryPickup()` (room.ts:442): also pick up pistols into an empty `secondary` (currently primaries only). Keep primary-first priority.
- README controls table: add `G`.

### 2.2 Helmet (custom effect)
- `PlayerConn.hasHelmet: boolean`. `handleBuy('helmet')`: requires `armor > 0`, `!hasHelmet`, `money >= PRICE_HELMET` (constant already exists).
- Effect: new shared constant `HELMET_PEN_MULT = 0.85`; at every damage application (hitscan `tryFire`, HE, bomb explosion), compute `pen = victim.hasHelmet ? armorPen * HELMET_PEN_MULT : armorPen`. (`applyArmor` signature unchanged — adjust pen at call sites.)
- Lifecycle: cleared on death-reset, fresh economy, `startMatch`, `resetToWarmup` (same places `hasKit`/armor reset).
- `SelfState.helm?: 1`; HUD shows `⛨ 100+`; buy menu row `Helmet $350` (both teams); bots wishlist `'helmet'` right after `'kevlar'` (`bots/buy.ts`).
- Test in `room.test.ts`: same shot does less HP damage to a helmeted victim.

### 2.3 Map-authored buy zones
- `MapDef.buyzones?: Array<{ team: TeamId; x: number; y: number; w: number; h: number }>` (tile rects) in `map/types.ts`; `MapBuilder.buyzone(team, x, y, w, h)` (builder currently tracks grid + callouts — add a list, emit in `build()`).
- `compileMap()`: expose `buyzoneAt(x, y): TeamId | null`.
- `dust2.ts`: author zones over T spawn (~x14-45,y45-55 subset) and CT spawn (~x44-57,y4-12 subset).
- `Room.inBuyzone()` (room.ts:379): use `map.buyzoneAt` when the map defines zones; keep the spawn-radius fallback for maps that don't (testarena unchanged).
- Add a case to `packages/shared/test/map.test.ts`.

### 2.4 Smoke blooms on rest; molotov ignites on impact
- `stepGrenade()` (`shared/src/sim/grenades.ts`) returns `{ pos, vel, bounced: boolean }` (true when either axis reflected).
- `updateGrenades()` per-kind detonation instead of pure fuse:
  - **smoke:** detonate when at rest (`vel == 0`) after ≥0.5s airtime; hard cap 3.5s.
  - **molotov/incendiary:** detonate on first bounce OR rest OR 2s cap.
  - **he/flash:** unchanged timed fuse (CS-accurate).
- Update `packages/shared/test/grenades.test.ts` for the new return shape + rest/bounce detonation. Integration script assertions are condition-based waits, so they should still pass — verify.

---

## Phase 3 — Bot intelligence (plan's FSM gaps)

`feat(bots): flash reaction, utility throws at map anchors, fire avoidance, save state, ct rotation`

All in `packages/server/src/bots/bot.ts` + small read-surfaces on `Room` + map data.

### 3.1 Flashes affect bots
In `think()`: if `p.blindUntilTick > tick` → drop current target, skip `findVisibleEnemy`, never set `BTN.ATTACK`; continue following the existing path (blind movement is fine/funny, matches CS bots).

### 3.2 Utility throws at map anchor points
- `MapDef.utilitySpots?: Array<{ tx: number; ty: number; site: 'A' | 'B'; kind: 'smoke' | 'flash' }>` + `MapBuilder.utilitySpot(...)` + passthrough in `compileMap` (world-px positions).
- `dust2.ts`: spots at the planned chokes — B doors, mid doors, long doors, catwalk.
- BotController: once per round, while navigating to its target site and within the throw-distance band of a matching spot (~250–400px, derived from throw speed 500 px/s and drag 1.4/s ≈ 335px travel), run a small throw sequence over a few ticks: `input.w = 4` → ATTACK aimed at the spot → switch back to gun. **Constraint to note:** `throwGrenade()` always throws `nades[0]`; bot buy order (smoke first, then flash — already the order in `decideBotBuys`) determines throw order. Smoke-at-choke first is the desired behavior anyway.

### 3.3 Bots path around fire
- `findPath()` (`bots/pathfinding.ts`) gains an optional `isBlocked(tx, ty)` predicate (defaults to `map.isSolid`).
- `Room` exposes `fireZonesInfo: Array<{ pos, radius }>` and a `fireVersion` counter (incremented on ignite/expire).
- Bot composes solid + fire-tile blocking; force repath when `fireVersion` changes or the next waypoint falls inside a fire zone. (Fire tiles are never treated blocked if they contain the goal, to avoid unreachable-goal stalls.)

### 3.4 Retreat/save at low HP
If `hp < 35`, no visible enemy, phase `live`, not the bomb carrier, and not a CT during `planted`: override goal to own spawn (`map.spawns[p.team][0]`). Still engages if an enemy becomes visible (self-defense).

### 3.5 CT rotate on info
- Room keeps a tiny bot blackboard: when any CT bot's `findVisibleEnemy` sees a T with `hasBomb`, record the nearest site to that carrier + tick.
- CT bots with no visible enemy and fresh info (< ~15s) adopt that site as `assignedSite`. (Rotation to the planted bomb already works via `phase === 'planted'` → `bombInfo.pos`.)

### 3.6 Verification additions
Extend `scripts/integration-bots.mjs`: assert at least one `nade_throw` event over the observed rounds; keep round-completion assertions as-is.

---

## Phase 4 — Audio (synth-only)

`feat(audio): webaudio synth sfx, positional mixing, accelerating bomb beep`

New: `packages/client/src/audio/synth.ts`, `packages/client/src/audio/sfx.ts`.

- **synth.ts:** compact ZzFX-style parameter synth (~100 lines, zero deps): oscillator (square/saw/noise) + pitch slide + decay envelope through a master `GainNode`. `AudioContext` created lazily; resumed on first `pointerdown` (Phaser input, once). Master volume + `M` mute toggle.
- **sfx.ts:** named cues with per-class params: `shot_pistol / shot_smg / shot_rifle / knife_swing`, `reload`, `buy_click`, `hitmarker`, `hurt`, `kill_confirm`, `nade_bounce?` (skip if noisy), `he_boom`, `flash_pop`, `smoke_pop`, `molly_ignite`, `plant`, `defused`, `c4_explosion`, `bomb_beep`, `round_start`, `round_win/lose` stingers.
- **Positional mixing:** volume falloff + stereo pan from distance/direction between the cue position and the current listener (predictor pos, or spectate target — GameScene already tracks `visionOrigin`).
- **Wiring (GameScene.handleEvent):** `shot` → cue by `getWeapon(ev.w).cls`; `he_pop/flash_pop/smoke_pop/molotov_ignite/planted/defused/exploded/kill/hit/hurt` → respective cues. HUD buy row click → `buy_click`.
- **Accelerating bomb beep:** in `GameScene.update`, while `match.ph === 'planted'`, schedule beeps at the planted-bomb position with interval lerped from ~1000ms → ~150ms as `match.end` (ticks) → 0.
- Verification is manual via preview (no console errors; cues audible; beep accelerates). No unit tests for sound output.

---

## Phase 5 — Visual polish: use the committed Kenney particle assets

`feat(render): particle-based muzzle flash, smoke, fire and explosion effects`

Files: `packages/client/src/scenes/BootScene.ts`, `GameScene.ts`.

- BootScene: load `assets/muzzle.png`, `assets/smoke.png`, `assets/flame.png`, `assets/glow.png` (loader is already failure-tolerant).
- GameScene:
  - **Muzzle flash:** brief `muzzle.png` sprite at shot origin, rotated toward the tracer endpoint (fallback: skip).
  - **Smoke zones:** cluster of 6–8 slowly rotating/drifting `smoke.png` sprites per zone, alpha tied to remaining ticks; keep the current flat-circle `zoneGfx` rendering as the no-texture fallback.
  - **Fire zones:** Phaser particle emitter with `flame.png` + `glow.png` underlay; same fallback.
  - **HE/C4 explosions:** `glow.png` burst instead of (or layered under) the current tween circle.
- Remove the now-unused `FLASH_MAX_BLIND` import from GameScene while touching it.
- Verify with preview screenshots (smoke cloud, fire patch, muzzle flash visible; fog mask still clips enemies).

---

## Phase 6 — Single-server deployment + docs

`feat(server): serve built client over http, same-origin api/ws resolution`

- `packages/server/src/index.ts`: for GET requests not matching `/rooms`, serve static files from the built client (`../../client/dist` resolved from the server module URL); fallback to `index.html`; minimal content-type map (html/js/css/png). API route keeps precedence.
- `packages/client/src/net/api.ts` (`apiBase`) and `connection.ts` (`serverUrl`): when the page is NOT on the Vite dev port (5173), use same-origin `location.host` for both HTTP and WS; keep the `:8090` fallback for dev.
- README: document `npm run build && npm start` single-server flow; add `G` (drop) and `M` (mute) to controls; mention helmet in the buy section.
- Clean up the `'helmet'` protocol comment (now real).

---

## Verification (end-to-end, after each phase and finally)

1. `npm test` — all shared + server suites including new `room.test.ts`, `lagcomp.test.ts`, updated `grenades.test.ts`, `map.test.ts`.
2. `node scripts/integration-round.mjs` and `node scripts/integration-bots.mjs` — must stay green (bots script gains the nade-throw assertion).
3. Preview tools (`preview_start` server + client per `.claude/launch.json`): play vs bots — verify G-drop/pickup loop, helmet purchase + HUD, buy-zone boundary, smoke blooming where it lands, molotov popping on impact, bots throwing a smoke at a choke, a blinded bot ceasing fire, audio cues + accelerating bomb beep, particle smoke/fire; screenshot for the visual items; `preview_console_logs` clean.
4. Final: `npm run build && npm start`, open `http://localhost:8090` directly — full match vs bots served entirely by the Node server.

## Explicitly out of scope (per user decisions)
- Extracting Room's round FSM into `packages/shared` (kept in Room; covered by new direct unit tests).
- Kenney **audio** samples (synth-only).
- Wallbangs, headshots, skins, ranked (unchanged from original plan).
