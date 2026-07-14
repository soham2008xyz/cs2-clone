# CS2 Clone — Audit Round 3: Fix & Improvement Plan

## Context

This is the third audit pass. Rounds 1–2 (plans `03`/`04`) landed 11 gameplay/UX fixes and a full test build-out; the tree is green today (**154 unit tests**: 75 shared, 70 server, 9 client; CI runs unit + integration + build on Node 20/22).

This pass found the project **is not actually playable and the server is trivially crashable** — two regressions that the current test/CI setup structurally cannot catch:

- The **client never boots into a match**. A Dependabot bump of `phaser` 3.90 → 4.2 (commit `d6603ba`) removed `GeometryMask.setInvertAlpha`, which `GameScene.create()` calls unconditionally for fog-of-war. `create()` throws a `TypeError` and the scene dies. **Confirmed live**: after quick-play the canvas stays black, the scene is inactive, the camera is never configured, and no players spawn — the exact signature of `create()` aborting at `GameScene.ts:119`. The client is **never typechecked in CI** (build = `vite build`, esbuild transpile only), so `tsc` — which *does* flag this line — never runs.
- The **server dies on one malformed WebSocket message**. `{t:'join', team:'X'}` reaches `getWeapon(DEFAULT_PISTOL['X'])` (`undefined`) which throws, and the dispatch is *outside* the handler's `try/catch`, so the process exits. **Confirmed live**: one crafted join took the server down (`server alive: false`).

Scope for this plan (per decisions): **Critical + High + Medium**. Phaser fix = **pin back to 3.90.x** (fastest safe restore; keeps existing scene code intact). Low-severity items and pure perf work are catalogued at the end as a backlog but not scheduled.

Baseline discipline (global CLAUDE.md): every phase ends green — `npm test`, both integration scripts, `npm run build` — and is committed with a conventional message.

---

## Phase 1 — Restore a working, type-safe client

**Commit:** `fix(client): pin phaser to 3.90 to restore fog-of-war mask, add typecheck to CI`

### 1.1 Pin Phaser back to 3.90.x (Critical — C1)
- `packages/client/package.json`: change `"phaser": "^4.2.0"` → `"phaser": "~3.90.0"`; run `npm install` to update the lockfile.
- Phaser 3.90 has `GeometryMask.setInvertAlpha`, so `GameScene.ts:112–124` (inverse darkness mask + enemy/tracer masks) works unchanged. No source edit needed for the fog-of-war logic itself.
- Add a short code comment near `GameScene.ts:118` noting the Phaser-4 incompatibility so a future upgrade doesn't silently reintroduce it. Optionally add `phaser` to a Dependabot ignore for major bumps (or note it in the PR so the 4.x bump is reopened deliberately with the mask port).

### 1.2 Fix the client type error in `sfx.ts` (High — F3)
- `packages/client/src/audio/sfx.ts:95`: `CUES ... satisfies Record<string, Layer[]>` narrows each entry to its literal shape, so `layer.at` is a type error on cues that omit `at`. Runtime-safe (`?? 0`) but blocks a clean `tsc`.
- Fix: iterate as `Layer[]` — e.g. `for (const layer of CUES[name] as Layer[])` — preserving the `CueName` key type from `keyof typeof CUES`.

### 1.3 Add a client typecheck and wire it into CI (High — F2, root cause of C1)
- `packages/client/package.json`: add `"typecheck": "tsc --noEmit"`.
- `.github/workflows/test.yml`: add a **Typecheck client** step before the build steps (after `Run tests`). This is the guard that would have caught C1.
- Verify: `npm run typecheck -w @cs2d/client` exits 0 after 1.1 + 1.2.

### 1.4 Verify the client actually plays
- `preview_start` server + client, quick-play into a match: confirm the map renders, the player spawns, fog-of-war darkness + enemy clipping work, movement/fire respond, `preview_console_logs` is clean (no `setInvertAlpha`/mask errors).

---

## Phase 2 — Server input hardening (crash & abuse surface)

**Commit:** `fix(server): validate ws inputs to prevent malformed-message crashes and abuse`

Root cause across these: `decode()` is bare `JSON.parse` (`protocol.ts:178`) with no validation, and the `ws.on('message')` dispatch (`index.ts:119–141`) is outside the `try/catch` that only wraps `decode`.

### 2.1 Reject invalid `team` (Critical — C2, confirmed crash)
- `packages/server/src/room.ts` `pickTeam()` (`:253`): `if (requested) return requested;` passes any string through. Change to validate membership: `if (requested === 'T' || requested === 'CT') return requested;` then fall through to the balance logic. This makes `addPlayer`/`spawnPos`/`givePistolLoadout` safe against a bogus team.
- `setTeam()` (`:331`): already guards `p.team === team` and phase, but add the same `team === 'T' || team === 'CT'` guard at the top so a mid-lobby `{t:'team', team:'X'}` is ignored, not applied.

### 2.2 Fix team-chat label desync (High — H4)
- `packages/server/src/index.ts:132–134`: `playerTeam = msg.team` runs **unconditionally**, even though `setTeam` may reject the change (wrong phase, or now, invalid team). Team chat is then mislabeled/misrouted. Fix: stop trusting `msg.team`; after `room.setTeam(...)`, read back the authoritative value — `playerTeam = room.players.get(playerId)?.team ?? playerTeam;`.

### 2.3 Validate bot difficulty on the WS path (High — H1)
- `packages/server/src/index.ts:131`: `msg.difficulty ?? 'normal'` is passed straight through, unlike the `POST /rooms` path which validates against `BOT_DIFFICULTIES`. A bad value stores on the bot and later throws in `bot.think()` (`DIFFICULTY_PARAMS[bad]` → `undefined.aimJitter`) inside the `setInterval` loop → delayed crash. Fix: reuse the existing `BOT_DIFFICULTIES` check (extract a tiny `validDifficulty(x)` helper shared by both call sites).

### 2.4 Sanitize aim, cap request body, gate `fillBots` (Medium — M1/M2/M3)
- **Aim (M2):** `packages/server/src/room.ts` `handleInput` (where `p.aim = input.a` is set, ~`:1064`): if `!Number.isFinite(input.a)`, drop the update (keep previous aim). Prevents `NaN` grenade velocity/positions (`fromAngle(input.a, …)` at `:825`) and `NaN` shot traces.
- **Body cap (M1):** `packages/server/src/index.ts` `readJsonBody` (`:20`): abort/`reject` once accumulated `body.length` exceeds a small cap (e.g. 16 KB) — `POST /rooms` bodies are tiny.
- **fillBots authz (M3):** `index.ts:130`: only allow `bots` from a client whose room has no other humans, or restrict to `phase === 'waiting'`. Minimal change: gate on `room.phase === 'waiting'` (bots are a pre-match convenience; mid-match backfill is already handled server-side on disconnect). Document the choice in the commit.

### 2.5 Tests (would have caught C2/H1)
- New `packages/server/test/room-input.test.ts` (or extend `room.test.ts`): `addPlayer`/`setTeam` with an invalid team is ignored and does **not** throw; `handleInput` with `a: NaN`/`Infinity` leaves `aim` unchanged and produces no `NaN` grenade on throw.
- Extend bot coverage: constructing/backfilling a bot with a bad difficulty is rejected upstream (assert `validDifficulty` behavior directly — pure function).

---

## Phase 3 — Round/warmup state-reset correctness

**Commit:** `fix(server): reset all per-life fields on warmup respawn and invalidate fire version on warmup reset`

### 3.1 Warmup respawn misses field resets (Medium — M4)
- `packages/server/src/room.ts` warmup-respawn block (~`:1044–1052`) resets `alive/hp/bloom/respawnTick/pos/primary` + `givePistolLoadout`, but unlike `startRound` (`:668–676`) it does **not** clear `blindUntilTick`, `armor`, `reloadEndTick`, `actionStartTick`, `nextShotTick`. A player who dies flashed / mid-reload / mid-plant during warmup respawns still blind/armored or with a stale `reloadEndTick` that fires on the fresh pistol. Fix: reset those five fields in the warmup path (mirror `startRound`). Consider extracting a small `resetPerLifeState(p)` helper used by both to prevent future drift.

### 3.2 `resetToWarmup` doesn't invalidate fire version (Medium — M9)
- `room.ts` `resetToWarmup` (~`:743–767`) calls `this.fires.clear()` (`:750`) but does not bump `fireVersion`. Bots read `fireInfo.version` (`:360`) to decide when to repath around fire; clearing without incrementing leaves a bot pathing around a now-gone fire. Fix: `this.fireVersion++` after `fires.clear()`. (Kills/deaths staleness on the warmup scoreboard is cosmetic — leave it; note in PR.)

### 3.3 Tests
- Extend `room.test.ts`: a player flashed/reloading who dies in warmup respawns with `blindUntilTick`/`reloadEndTick` cleared and `armor === 0`; `resetToWarmup` increments `fireVersion` when fires were active.

---

## Phase 4 — Simulation & map fidelity fixes

**Commit:** `fix(shared): armor depletion carryover and single-site map center handling`

### 4.1 Armor gives full protection at 1 HP of armor (Medium — M6)
- `packages/shared/src/sim/combat.ts:36–42`: any `armor > 0` grants the full `armorPen` reduction for the whole shot; real CS carries the overflow — once armor depletes mid-hit the remainder hits HP unmitigated. Fix: split the shot — mitigate up to the damage the remaining armor can absorb, apply the rest at full. Keep it deterministic (identical on client prediction and server). Add a `combat.test.ts` case: near-zero armor no longer fully absorbs a rifle shot.
- *If preferred as a deliberate simplification, downgrade to a documented non-fix* — but the current behavior makes 1-armor "free," so recommend fixing.

### 4.2 Single-site maps report bombsite B at tile (0,0) (Medium — M7)
- `packages/shared/src/map/compile.ts:46–49`: `siteCenters.B` divides by `max(1, n)`, so a one-site map (`testarena`, used by the integration scripts) yields `{x:0,y:0}` — inside the border wall. Any consumer reading `siteCenters.B` paths to a wall corner. Fix: emit `null`/omit absent sites (adjust the `siteCenters` type and its consumers in bot goal logic accordingly), or assert both sites exist at compile time for maps that require them. Add a `map.test.ts` assertion on `testarena`.

---

## Phase 5 — Bot objective awareness

**Commit:** `feat(bots): retrieve dropped bomb and let mid-round backfill bots buy`

### 5.1 Bots never retrieve a dropped bomb (Medium — M8a)
- `packages/server/src/bots/bot.ts` `computeGoal` (~`:206–217`): T goals are always the assigned site (or spawn when low HP); nothing routes a T to a dropped bomb. If the carrier dies away from a site, the objective strands for the round. Fix: when `room.bombInfo.mode === 'dropped'` and no T carries it, route the nearest/assigned T toward `bombInfo.pos`; pickup remains the existing proximity check.

### 5.2 Backfill bot joining mid-`live` never buys that round (Medium — M8b)
- `bots/bot.ts:102–108`: `boughtRound` is set on the first observed tick even when `buyingAllowed` is false (outside buyzone / past `BUY_WINDOW`), so a backfill bot plays the round pistol-only and doesn't retry. Fix: only mark `boughtRound` once a buy is actually attempted/allowed; otherwise leave it so the next round buys normally.

### 5.3 Verify
- `node scripts/integration-bots.mjs` stays green (rounds complete, ≥1 nade throw). Spot-check logs that a stranded bomb now gets retrieved and backfill bots aren't perpetually pistol-only.

---

## Phase 6 — Close the highest-value test/coverage gaps

**Commit:** `test: cover bomb explosion, malformed input, and untested sim/client pure functions`

New tests only (no source change), following established patterns (`liveRoom()`, `feeder()`, `guts()`, pure-fn tables):

- **`explodeBomb` path** (server) — currently zero coverage: drive a plant to detonation and assert explosion damage, `BOMB_ARMOR_PEN`, the `c4` kill event, and the `bomb_exploded` round reason/payout. (Existing post-plant tests resolve via elimination, never explosion.)
- **CT-eliminated-during-`planted`** (`room.ts:776`) → `elimination_t` (only the T-death branch is tested today).
- **`grenades.data.ts` data-sanity table** (shared) mirroring `weapons-data.test.ts`: `price≥0`, `fuse>0`, `maxCarry≥1`, molotov/incendiary team pairing.
- **`math.ts` edges** (shared): `lerpAngle` wrap branches (`d>π`, `d<−π`) and `norm` zero-vector — both feed client interpolation, both untested.
- **Client pure logic** (client): `net/connection.ts serverUrl()`, `net/api.ts apiBase()` (port/protocol branches), `menu.ts join()` map-lookup fallback chain, `chat.ts` 8-line cap + `textContent` escaping (jsdom).
- **Client scene boot smoke test** (client): a lightweight jsdom/headless check that constructing the scene graph doesn't throw — the unit-level complement to Phase 1's typecheck against C1-class regressions. If Phaser-in-jsdom proves too heavy, rely on the CI typecheck + the `preview` boot check and note the gap.

Report before/after test counts and `npm test` duration.

---

## Backlog (out of scope this pass — catalogued, not scheduled)

**Low-severity correctness:** DDA diagonal-corner leak in `raycastGrid` (`math.ts:66`); HE/flash self-occlude when detonating inside their own smoke (`grenades.ts` via `rayCircle` returning 0 inside a circle); hard-snap guard skips when server `x===0` (`GameScene.ts:206`); `HudScene` `scale.on('resize')` listener never removed (latent, only bites if `scene.restart('Hud')` is ever added); `nade_bounce` cue defined but never played; no reconnect path (disconnect drops economy/loadout); lag-comp snaps to nearest frame (no interpolation) despite the doc; `connection.onmessage` lacks a `decode` try/catch; chat log persists visually across matches.

**Perf (per-frame allocation / O(n²)):** `visibilityPolygon` recomputed every render frame with a fresh 240-`Vec2` array (biggest client win — cache when origin+smokes unchanged); `fromAngle` computed twice per vision ray (`vision.ts` — halve the trig); `SnapshotBuffer.sample()` allocates a `Map`+N objects per frame (`interpolation.ts`); A* linear min-`f` scan is O(n²) (`pathfinding.ts:59` — use a heap); `lagComp.record` allocates a `Map`+`Vec2` per player per tick (`lagcomp.ts:19`); `teamPlayers`/`aliveCount` allocate multiple arrays per tick (`room.ts:395`); `smokeOccluders` getter rebuilds an array on every access; `broadcastSnapshot` per-player `events.filter` alloc; `synth.ts` regenerates a white-noise buffer per gunshot.

**Also noted:** `index.ts` HTTP/WS layer still has no direct unit tests (integration-only) — a known open item from plan 04; the `serveClient` path-traversal guard and `4004` unknown-room close are exercised only indirectly.

---

## Verification (end-to-end, after all phases)

1. `npm test` — full suite green, including all new cases; report the count delta.
2. `npm run typecheck -w @cs2d/client` — exits 0 (new guard).
3. `node scripts/integration-round.mjs` && `node scripts/integration-bots.mjs` — green (re-run `integration-bots` once under CPU load per the flake-repro memory).
4. `npm run build` — client + server bundle/typecheck clean.
5. **Manual crash-repro regression:** with the server running, send `{t:'join', team:'X'}` and a `bots` message with a bad difficulty over a raw WS — server stays up (was: process exit).
6. **Preview:** `preview_start` server + client; quick-play into a match — map renders, player spawns, fog-of-war + enemy clipping work, movement/fire respond, `preview_console_logs` clean. Play a full round vs bots; confirm a dropped bomb gets retrieved.
