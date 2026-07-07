# Test Coverage Improvement Plan — cs2-clone

## Effort estimate

**Approved scope: both phases, ~2–3 days total.**

- **Phase A (defects + shared pure-fn tests + server Room/roomManager tests): ~1 day.** The core, highest-value slice — closes the room.ts risk surface, fixes the known defects, adds cheap high-confidence pure-function coverage.
- **Phase B (bot tests + client test scaffolding + CI wiring): ~1–1.5 additional days.** Lower ROI per hour (non-deterministic AI, greenfield client tooling, CI infra), implemented after Phase A lands so it can build on the `liveRoom()` patterns and hardened integration scripts Phase A produces.

Implementation proceeds Phase A → Phase B in sequence (Phase B's bot tests and CI wiring both depend on Phase A work); see "Phasing" at the end of the Work Plan section for the exact item-by-item order.

## Context

A full test-suite audit (2026-07-07) found the suite healthy (72 unit tests passing, strong deterministic patterns) but with concentrated gaps and a few defects:

- **One test-logic bug**: `packages/shared/test/combat.test.ts` visibility-polygon test claims to check "no vertex inside a solid tile" but only bounds `p.x` — never `p.y`, never solidity.
- **Highest-risk untested surface**: `packages/server/src/room.ts` (1,204 lines) — buy validation, `tryFire` (semi-auto edge, fire rate, ammo, lag-comp usage), bomb-carrier lifecycle (drop/pickup), plant/defuse interruption + site-only rule, halftime side-swap, match end, OT money reset, warmup reset, team auto-balance.
- **Zero coverage**: `bots/bot.ts` (255 lines), `bots/buy.ts`, `roomManager.ts`, server `index.ts` HTTP/WS endpoints, `testarena` map, client package.
- **Shared sim edge gaps**: `friendlyFire=true`, behind-shooter shots, flash beyond `FLASH_RANGE`, molotov DPS at sim level, weapon mobility multiplier, weapon/grenade data sanity, `clampMoney`, `winReward('time')`.
- **Dead/drifting code found in passing**: unused `isOvertimeStart` (match.ts:52), hardcoded flash fuse `1.6` instead of `FLASH_FUSE` (grenades.data.ts:21), integration scripts hardcode a copy of the `BTN` bitmask.
- **Process**: CI (`.github/workflows/test.yml`) never runs the integration scripts; `scripts/integration-bots.mjs` still has the pre-fix fragile server-spawn pattern (npx, 15s timeout, no early-exit detection) that was just fixed in `integration-round.mjs` (commit fd6453e); its "sanity" comment at line 95 promises an assertion that doesn't exist.

Intended outcome: close the high-value coverage gaps with deterministic unit tests following the repo's existing patterns (tick-driven Room tests, MapBuilder micro-maps), fix the defective/misleading tests, harden the second integration script, and wire integration into CI.

## Existing patterns to reuse (do not invent new harnesses)

- `packages/server/test/room.test.ts`: `FAST` timings object, `guts(room)` private-access cast, `step(room, n)` / `stepUntil(room, cond, cap)`, `feeder(room)` input helper with auto-seq, `fakeWs()` message recorder, `liveRoom()` factory, `plantBomb()` helper.
- `packages/shared/test/*.test.ts`: `MapBuilder` micro-maps via `compileMap`, `at(tx, ty)` tile-center helper, `mulberry32` seeded rng.
- `scripts/integration-round.mjs` (post-fd6453e): direct `node_modules/.bin/tsx` spawn with early-exit detection, consuming `takeEvent`, per-client `syncRoundEnd`.

## room.ts internals (test-design reference)

**handleBuy** (~419): gated by `buyingAllowed(p)` (~405: alive + in buyzone + within `liveStartTick + sec(BUY_WINDOW)` during live, or in buyzone during freeze). Kevlar (~423: money≥650, armor<100 → armor=100), helmet (~429: no dup, armor>0, money≥350), kit (~435: CT only), grenades (~442: team restriction, `maxCarry` ~446, `GRENADE_MAX_TOTAL` ~445), weapons (~453: unknown ids ignored, knife rejected, team restriction, money check, sets `activeSlot`, clears `reloadEndTick`).

**tryFire** (~950): semi-auto edge via `p.prevButtons` (set ~1078 after each input) — blocks if `!w.auto && (prevButtons & ATTACK)`. Fire-rate cooldown via `p.nextShotTick` (~961: `tick + round(TICK_RATE/(rpm/60))`, checked ~954). Ammo decrement only if slot exists (~962). Empty mag (~956: ammo≤0 → `startReload`, no fire). Reload blocks fire (~954: `reloadEndTick>0`). Lag comp: `lagComp.rewind(p.lastSeenTick, tick)` (~969); `lastSeenTick` set from `input.k` (~1063). Events: `shot`(~978, broadcast), `hit`(~986, shooter-only), `hurt`(~987, victim-only), `kill` via `onKill()`(~1000).

**startReload/finishReload** (~783/791): duration `round(w.reloadSec * TICK_RATE)`, guarded by slot exists + `reloadEndTick===0` + `ammo<magazine` + `reserve>0`. finishReload: `take=min(magazine-ammo, reserve)`. Interrupted by `switchSlot` (~812), `dropActiveWeapon` (~510), buying a new primary (~469), death (reset in `startRound` ~672).

**Plant/defuse** (`updatePlantDefuse` ~545): progress via `p.actionStartTick` (set ~556/568), reset on releasing USE or moving (~547/555/567 — button mask check). Progress fraction for UI: `(tick - actionStartTick)/total` (~1132). Site-only via `map.siteAt(pos) !== null` (~554) — no global constant, map-based. Kit vs no-kit duration (~569: `sec(hasKit ? defuseKit : defuse)`). Requires `p.hasBomb` to plant (~553). `plantBomb`(~580): sets `bomb.mode='planted'`, `explodeTick`, phase, awards `PLANT_REWARD`. `defuseBomb`(~591): `bomb.mode='none'`, `endRound('bomb_defused')`.

**Bomb carrier lifecycle**: `dropBomb`(~525) called from `removePlayer`(~323), `onKill`(~1004). `bombPickupCheck`(~531, every step ~1089): requires `team==='T' && alive && dist<=PICKUP_RADIUS`, sets `hasBomb=true`. `bomb.mode` ∈ `'none'|'carried'|'dropped'|'planted'`.

**Match arc**: `startRound`(~637): side swap via `isSideSwap(roundNumber)`(~640) — flips `player.team`(~642), swaps `score`(~644) and `streaks`(~646). OT money reset via `isOvertimeHalfStart`(~653/678: `money=OT_MONEY`). Pistol reset via `isPistolRound`(~652/677: full loadout reset + `streaks={T:0,CT:0}`). `endRound`(~714): calls `roundPayout`, applies no-save-on-time-win rule (~721: `reason==='time' && p.alive` skipped). `afterRoundEnd`(~732): `matchWinner(score)`(~733) → emits `match_end` + phase, else `startRound()`. `resetToWarmup`(~743): phase→'waiting', clears state, resets players. `checkWinConditions`(~769): elimination via `aliveCount===0`, time via `tick>=phaseEndTick`; in `planted` phase only CT death/defuse/explosion resolves it. `pickTeam`(~253): joins smaller team.

**Constructor**: `new Room(mapName, timings: Partial<RoomTimings> = {})` — merges with defaults; `getMap(mapName)` may throw on unknown map. `sec(s) = round(s * TICK_RATE)`.

**Public read surface (no `guts()` needed)**: `room.map`, `room.players` (Map), `room.tick`, `room.phase`, `room.roundNumber`, `room.score`, `room.times`, plus bot-intel getters.

**Test pattern already established** (room.test.ts): `FAST` timings, `guts()` cast for private fields (`step()`, `bomb`, `streaks`, `roundNumber`, `phaseEndTick`, `activeNades`, `smokes`, `fires`, `groundItems`), `step(r,n)`/`stepUntil(r,cond,cap)`, `feeder(room)` auto-seq input helper, `fakeWs()` message recorder, `liveRoom()` factory, `plantBomb()` helper. Tests never call `room.start()` (avoids the real `setInterval` timer) — they drive ticks manually via `step()`.

## roomManager.ts (fully testable, no sockets)

`create(map, backfillBots, timings?, botDifficulty?)` — generates unique 4-char code (unambiguous charset), calls `room.start()` immediately (⚠ starts the real timer — tests must call a stop/cleanup or accept a live interval; check for a `stop()`/`destroy()` method before relying on GC). `get(code)` case-insensitive. `list()` filters to rooms with `players.size>0`. `reap()` purges human-less rooms after `REAP_GRACE_MS` (60s) via `room.stop()`.

## index.ts HTTP/WS (partially testable)

`POST /rooms`: bad map/difficulty silently default (dust2/normal) rather than erroring — body-parse failure is the only 400 path. `GET /rooms` returns maps+rooms. WS upgrade: unknown room code closes with 4004. Message dispatch is a straightforward switch to Room methods (join/i/buy/bots/team/chat/ping). HTTP/WS layer is coupled to Node `http`/`ws` — best exercised by the existing integration scripts rather than unit tests; only the POST /rooms default-fallback behavior is cheaply unit-testable if the route handler can be imported standalone (needs verification of index.ts's export shape — flag as a design question, may require a small refactor to extract the handler, which is out of scope if it risks touching production code paths unnecessarily).

## Bots, shared sim, client findings

**BotController** (`bots/bot.ts`): `constructor(playerId, difficulty='normal')`, single public method `think(room, tick)` called from `Room.step()` (room.ts:1041) ~60×/sec; drives via `room.handleInput()`/`room.handleBuy()` like a networked client. Behaviors: buy once per round (~102), combat via `findVisibleEnemy`+`wantsToFire` (~126), nav via `computeGoal`+`ensurePath` (~152), plant/defuse (~161), utility throw with distance bands (~145,188). **Uses bare non-seeded `Math.random()`** (site pick ~104, aim jitter ~139) — bot behavior is inherently non-deterministic; any bot test must either mock `Math.random()` or assert statistical/structural properties (e.g., "eventually fires when enemy visible over N ticks") rather than exact trajectories. Depends on `room.players`, `.phase`, `.roundNumber`, `.handleBuy`, `.handleInput`, `.map`, `.fireInfo`, `.smokeOccluders`, `.botIntel` (public read surface, room.ts:350-368) — a real `Room` (via `liveRoom()`) is the natural harness; a fake room is possible but `findPath()` needs a real `map.isSolid`.

**buy.ts**: `decideBotBuys(money, team, hasKit): string[]` — pure, deterministic, trivially unit-testable in isolation (primary→smg→deagle fallback by money, kevlar+helmet, CT kit, smoke+flash, team-exclusive nade, he).

**vision.ts**: `visibilityPolygon(origin, map, smokes?, maxDist?)` — 240-ray fan, DDA grid + circle occlusion, returns closed Vec2[] of length 240. `hasLineOfSight(from, to, map, smokes?, maxDist?)` — single ray, 0.5px boundary epsilon. The existing polygon test's boundary check needs a **1px margin AND both axes** (not just x) — confirms the audit's bug finding.

**weapons.data.ts**: 10 weapons (`knife, glock, usp, deagle, mac10, mp9, galil, famas, ak47, m4a4`), fields `id,name,cls,team?,price,killReward,damage,armorPen,rpm,magazine,reserve,reloadSec,mobility,spreadBase,spreadMove,spreadPerShot,spreadDecay,rangeMod,range,auto`. Sanity bounds observed: price≥0, mobility∈[0.86,1.0], rangeMod∈[0.82,0.98], armorPen∈(0,1), magazine>0 except knife, pistols have `auto=false`.

**movement.ts**: `stepMovement(pos, buttons, speedMult, map, dt)` — `speedMult` is weapon mobility, applied as `RUN_SPEED * speedMult * (walk ? WALK_SPEED_MULT : 1)`. Call site: room.ts:1070 passes `activeWeapon(p).mobility`. No existing test varies `speedMult` away from `1`.

**grenades.ts**: `resolveFlashBlind` — linear-ish distance factor `1 - d/FLASH_RANGE` (0 beyond 500px) × angle factor `lerp(1,0.15,diff/π)`; beyond-range and behind-look-direction are both cheaply testable gaps. `resolveHeDamage` — linear falloff `HE_MAX_DAMAGE*(1-d/HE_RADIUS)`, zero beyond 130px. `stepGrenade` returns `{pos,vel,bounced}`.

**client/src**: `net/prediction.ts` and `net/interpolation.ts` are DOM/Phaser-free pure logic — real unit-test candidates. `net/api.ts` (protocol marshaling) also pure. Scenes/render are Phaser-coupled, low test value. No test script exists yet for the client package.

**math.ts**: 18 exports (vector ops, angle ops, `raycastGrid`, `rayCircle`, `mulberry32`). Only `mulberry32` is directly exercised today (via seeding in combat.test.ts); `raycastGrid`/`rayCircle` are only indirectly covered through vision/combat tests — acceptable given they're simple/pure, but a couple of direct edge-case tests (ray parallel to grid lines, ray from inside solid) would be cheap insurance.

## Work plan

### Guiding principles
- Every new test follows an existing established pattern (Room tick-driven tests, MapBuilder micro-maps, pure-function tests) — no new test infrastructure invented.
- Prioritize by risk × cheapness: pure-function tests (buy.ts, data sanity, math edges) are cheapest and go first; Room-level integration-style unit tests are next; bot AI (non-deterministic) gets structural/smoke-level tests only; client and HTTP layer get the smallest viable coverage given effort required.
- Fix the identified defects (visibility polygon test, dead code, integration-bots.mjs, misleading comment) alongside new coverage, not as an afterthought.

### 1. Fix existing defects first (small, isolated, immediate value)
- **`packages/shared/test/combat.test.ts`** visibility-polygon test: check both `p.x` and `p.y` against tile bounds with proper margin, and additionally assert `!map.isSolidAt(p.x, p.y)` isn't meaningfully violated (using the 1px epsilon confirmed above) for a true "no vertex sits inside a wall" check.
- **`scripts/integration-bots.mjs`**: apply the same hardening as `integration-round.mjs` (fd6453e) — spawn `node_modules/.bin/tsx` directly, add early-exit detection, SIGKILL backstop in cleanup. Also fix the comment at line 95 to stop promising an unimplemented assertion (either remove the misleading comment text or replace it with the already-logged sanity output, since asserting both-teams-win over only 4 rounds would itself be flaky).
- **`packages/shared/src/sim/grenades.data.ts:1,21`**: `FLASH_FUSE` is **not currently imported** (only `HE_FUSE, MAX_FLASH_CARRY, MOLOTOV_FUSE, SMOKE_FUSE` are) — add it to the import list and replace the hardcoded `1.6` literal at line 21 with `FLASH_FUSE`. Confirmed `FLASH_FUSE = 1.6` in constants.ts:62, so this is a value-preserving cleanup, not a behavior change.
- **`packages/shared/src/sim/match.ts`**: leave `isOvertimeStart` as-is per repo convention (don't delete pre-existing dead code unasked) but flag it in the PR description; no test added for genuinely-unused code.
- **BTN bitmask duplication** in integration scripts: leave as-is (cosmetic, not a correctness bug) — note only.

### 2. New shared-package unit tests (`packages/shared/test/`)

- **`weapons-data.test.ts`** (new file): data-sanity table test over `WEAPONS` — every weapon has `price>=0`, `damage>0`, `magazine>=0`, `rangeMod` in `(0,1]`, `armorPen` in `(0,1)`, `mobility` in `(0,1]`, pistols (`cls==='pistol'`) have `auto:false`. Loop-driven, ~15 lines.
- **`grenades.test.ts`** additions: flash beyond `FLASH_RANGE` → zero hits (mirrors existing "no blind beyond LOS-blocking wall" test shape); HE beyond `HE_RADIUS` already covered indirectly — add an explicit boundary-adjacent case if not redundant.
- **`combat.test.ts`** additions: `friendlyFire=true` path (teammate now hit); shooter behind target (`dist<=0` guard) returns no hit.
- **`movement.test.ts`** addition: `stepMovement` with `speedMult=0.5` moves at half `RUN_SPEED` (mirrors the existing walk-speed test pattern at movement.test.ts:35).
- **`economy.test.ts`** or extend `match.test.ts`'s economy describe block: `clampMoney` bounds (negative→0, over `MAX_MONEY`→capped), `winReward('time')` returns `REWARD_WIN_TIME`, `totalRounds` sums both teams.
- **`math.test.ts`** (new, small file): 2-3 edge cases for `raycastGrid` (ray starting inside a solid tile returns 0 or near-0; ray parallel to an axis doesn't infinite-loop/NaN) and `rayCircle` (ray missing the circle entirely returns null).
- **`map.test.ts`** addition: a minimal `testarena` sanity block (compiles, has T/CT spawns, site A reachable) mirroring the existing dust2 tests but scoped down — since the integration suite depends on this map, a unit-level guard against accidental map-def breakage is cheap insurance.

### 3. New server-package unit tests (`packages/server/test/`)

All follow the `room.test.ts` pattern (`liveRoom()`, `feeder()`, `step`/`stepUntil`, `guts()`). Organize as new `describe` blocks in `room.test.ts` (extending the existing file, matching its existing organizational style) rather than fragmenting into many new files, unless a block grows large enough to warrant its own file (buy and fire logic likely do, given their size — see below).

- **`room-buy.test.ts`** and **`room-fire.test.ts`** (new files — named to make the `room.ts` relationship explicit, since the repo's existing convention is one test file per one source file and `handleBuy`/`tryFire` are methods on `room.ts`, not separate source modules; bare `buy.test.ts` would also collide in intent with the unrelated `bots/buy.test.ts` planned below).
  - **`room-buy.test.ts`**: buy window enforcement (rejected before freeze buyzone entry, rejected after `BUY_WINDOW` elapses in live), buyzone radius rejection, kevlar/helmet money+state transitions, kit CT-only restriction, `GRENADE_MAX_TOTAL` cap across mixed grenade types, per-type `maxCarry` cap (e.g., 2nd flash allowed, 3rd rejected), unknown item id silently ignored, weapon purchase money deduction + `activeSlot` update + `reloadEndTick` clear.
  - **`room-fire.test.ts`**: semi-auto edge (holding ATTACK across two ticks fires once, release+press fires again), fire-rate cooldown (`nextShotTick` blocks early re-fire), ammo decrement to zero triggers auto-reload instead of firing, reload blocks firing, `shot`/`hit`/`hurt`/`kill` event emission and targeting (shooter-only vs victim-only vs broadcast), lag-comp rewind path using `input.k` (verify a moving target is hit/missed based on rewound vs live position — adapt the existing `lagcomp.test.ts` scenario into a Room-level check).
- **`room.test.ts`** additions (extend existing describes):
  - *reload*: interrupted by slot switch, by dropping weapon, by buying a new primary.
  - *plant/defuse interruption*: releasing USE mid-plant resets progress to 0; moving mid-defuse resets progress; off-site plant attempt rejected.
  - *bomb carrier*: bomb drops on carrier death, becomes `'dropped'`; pickup requires `PICKUP_RADIUS` proximity and T team.
  - *match arc*: halftime side-swap flips `player.team`, swaps `score`, swaps `streaks` (extend the existing round-13-pistol test to also assert the swap fields); OT money reset sets `OT_MONEY` at an OT half start; `match_end` emitted and phase set when `matchWinner` returns non-null (drive score directly via `guts(room).score` then trigger `afterRoundEnd`); `resetToWarmup` triggered when a team empties (via `removePlayer`) clears bomb/nades/scores and respawns remaining players.
  - *team balance*: `pickTeam()` assigns the smaller team when no team requested.
- **`roomManager.test.ts`** (new file). Confirmed API: `create()` returns `RoomMeta` (no direct room handle — `get(code)` returns `{room, meta}`), `reap()` reads `Date.now()` directly (not injectable) and compares against `createdAt` captured at `create()` time via `REAP_GRACE_MS=60000`. Plan: `get(meta.code).room.stop()` in an `afterEach` for every created room (stop() is public) to avoid leaking `setInterval` timers across the vitest process. For `reap()` timing: **order matters** — first assert the room survives `reap()` immediately after creation using the *real* `Date.now()` (spy not yet installed), then install `vi.spyOn(Date, 'now').mockReturnValue(...)` (not `mockImplementation` calling through) set past `REAP_GRACE_MS`, call `reap()` again, and confirm the room is gone; restore the spy in `afterEach`. Writing the "not yet reaped" assertion before the spy install (not after, with a smaller offset) removes any chance of a future edit accidentally spying first and silently losing that assertion's real-clock guarantee. Also test: unique codes (create many, assert no collisions in a reasonable sample), `get()` case-insensitivity, `list()` excludes empty rooms, a room with a human `ws !== null` survives `reap()` regardless of age.
- **`bots/buy.test.ts`** (new file): pure-function table test over `decideBotBuys(money, team, hasKit)` — mirrors the weapons-data sanity test shape; cheap, deterministic, high value.
- **`bots/bot.test.ts`** (new file, smoke-level given non-determinism, **time-boxed**): with `Math.random` stubbed via `vi.spyOn(Math, 'random').mockReturnValue(...)` (restored in `afterEach`), assert structural behavior over a `liveRoom()` + real bot added via `room.addBot()`/`fillBots()`: bot eventually buys within its first freeze/live window, bot moves (position changes over N ticks when an enemy is not visible), bot fires when an enemy is placed in direct LOS at close range within M ticks. **Known fragility**: bot.ts currently has exactly two `Math.random()` call sites (site pick, aim jitter); mocking a fixed return value is workable today but any future addition of a third call site in bot.ts will silently desync the mocked sequence and produce a confusing failure far from its cause — call this out in the test file's header comment so a future editor isn't caught off guard. **Cap**: if the first two structural assertions don't stabilize within roughly an hour of effort, cut this file and rely on `integration-bots.mjs` alone for bot coverage — don't sink further time chasing AI-timing flakiness at the unit tier.

### 4. Client package: introduce a test script and cover pure net logic

- Confirmed: neither `shared` nor `server` has a `vitest.config.*` file anywhere in the repo — both run zero-config (`"test": "vitest run"` alone). Client currently has no `devDependencies` on vitest and no test script at all. Add `vitest` (same version as shared/server: `^4.1.10`) to `packages/client/package.json` devDependencies and a `"test": "vitest run"` script — no new config file needed, matching the existing zero-config convention.
- Add `client` to the root `test` script chain (`package.json`: `"test": "npm run test -w @cs2d/shared && npm run test -w @cs2d/server && npm run test -w @cs2d/client"`) once it has at least one passing test.
- **`packages/client/test/prediction.test.ts`**: mirror `shared/test/prediction.test.ts`'s determinism-style assertions but at the client module level — reconciliation converges given a sequence of acked/unacked inputs.
- **`packages/client/test/interpolation.test.ts`**: snapshot interpolation between two known ticks produces the expected lerped position/angle at a fractional time; boundary behavior at/before first snapshot and at/after last snapshot.
- Keep this slice small — scenes/rendering remain untested per the audit (Phaser-coupled, low ROI); do not attempt to test `GameScene`/`HudScene`/`mapRender`.

### 5. CI wiring for integration scripts

- Add root `package.json` script `test:integration` running both `scripts/integration-round.mjs` and `scripts/integration-bots.mjs` sequentially (they use different ports, 8091/8092, so could run in parallel, but sequential is simpler and avoids masking a shared-resource bug; keep it simple unless CI time becomes a concern).
- Add a step to `.github/workflows/test.yml` after the existing `Run tests` step (and before the build steps, so a broken round/bot flow fails fast) invoking `npm run test:integration`. Since these spawn a real server via `tsx`, this must run after `npm ci` (already present) and does not need the build step.
- This directly follows from hardening both scripts in step 1 — without the hardening, wiring flaky scripts into CI would just add noise.
- **Note**: CI wiring runs the E2E scripts; it does not add any unit coverage for `index.ts`'s HTTP/WS layer itself. The `index.ts` gap identified in the audit (POST /rooms validation, WS upgrade error paths) remains open after this item — it's exercised indirectly by the integration scripts, not directly unit-tested. Call this out explicitly so it isn't mistaken for closed.

### Phasing (both phases approved — implement in this order)

**Phase A (~1 day):**
1. Defect fixes (independent, no blockers).
2. Shared pure-function tests (independent, fast to write/verify).
3. Server `room-buy`/`room-fire`/`room.test.ts` additions + `roomManager.test.ts` (API details already confirmed during exploration — no further verification needed before implementing).

**Phase B (~1–1.5 additional days, starts once Phase A lands):**
4. Bot tests (depends on Phase A's `liveRoom()` patterns; lowest priority given non-determinism; time-boxed per the cap noted above).
5. Client test scaffolding (independent of 4, can run in parallel with it).
6. CI wiring (depends on item 1's script hardening from Phase A being complete; otherwise independent of 4/5).

Run `npm test` after every item in both phases, not just at the end of each phase, to catch regressions immediately.

## Verification

- `npm test` (root) must stay green throughout — run after each new test file to catch regressions immediately, not just at the end.
- For each new Room-level test, confirm it fails before the corresponding source behavior existed (not applicable here since source already exists — instead, confirm each new test actually exercises the intended branch by temporarily breaking the source locally and observing the test fail, then reverting — standard TDD-style sanity check, done ad hoc rather than formally per the codebase's existing non-TDD test style).
- Run `node scripts/integration-round.mjs` and `node scripts/integration-bots.mjs` directly (not just via CI) after hardening the latter, including at least one repeat run under artificial CPU load (the spinner technique from the flake fix) to confirm `integration-bots.mjs` doesn't regress the same way.
- After wiring CI, either push to a branch and confirm the Actions run passes, or at minimum dry-run the new `npm run test:integration` script locally exactly as CI would invoke it.
- Full suite timing check: report before/after test counts and total `npm test` duration so the user can see the coverage delta at a glance.
