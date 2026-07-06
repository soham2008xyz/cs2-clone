# CS2 Clone — Fix Audit Findings (3 bugs + 8 fidelity gaps)

## Context

A full audit of the implementation against `.claude/plans/01-…` and `.claude/plans/02-…` found the project plan-complete and green (69 unit tests, both integration suites, production build), but surfaced **3 real bugs** and **8 fidelity/robustness gaps** not covered by either plan. This plan fixes all 11. Baseline: everything is currently passing, so every phase must end green (`npm test`, both integration scripts) and be committed conventionally per global CLAUDE.md.

Issue numbering below matches the audit report.

---

## Phase 1 — Server gameplay bug fixes

Commit: `fix(gameplay): survivor loadout preservation, full weapon drop on death, bomb armor pen constant`

### 1.1 Survivors with no pistol lose their primary (Bug #1)
File: `packages/server/src/room.ts`

- Remove `p.primary = null;` from `givePistolLoadout()` (room.ts:265-270) — the helper should only assign the secondary + activeSlot.
- Preserve existing behavior at the two call sites that relied on the side effect (verified: all other callers already null `primary` explicitly first):
  - warmup respawn block in `step()` (room.ts:1032-1039): add `p.primary = null;` before the call.
  - `setTeam()` (room.ts:336): add `p.primary = null;` before the call.
- The survivor branch in `startRound()` (room.ts:678-681) is now automatically correct: a survivor missing a secondary gets a fresh pistol *without* losing their primary; the following `p.activeSlot = p.primary ? 1 : 2` already picks the right slot.

### 1.2 Dead players drop only their primary (Nit #4)
File: `packages/server/src/room.ts`

- In `onKill()` (room.ts:988-991) and `killByUtility()` (room.ts:833-836): after dropping the primary, also drop `victim.secondary` via the existing `dropWeapon()` and null the slot. `tryPickup()` already handles pistols into an empty secondary — no pickup changes needed.
- Skip `explodeBomb()` deaths (round ends immediately; `groundItems` are cleared in `startRound()`).

### 1.3 Hardcoded bomb armor penetration (Nit #10)
File: `packages/server/src/room.ts`

- Add `const BOMB_ARMOR_PEN = 0.6;` next to `BOMB_EXPLOSION_DAMAGE` (room.ts:88) and use it in `explodeBomb()` (room.ts:591) instead of the literal `0.6`.

### 1.4 Tests (`packages/server/test/room.test.ts`)
- New: survivor who G-drops their pistol and survives the round still has their primary next round (drive via `handleInput` + step, same style as the existing "G drops the held gun" test at room.test.ts:244).
- New: killing a player who holds both a primary and a non-default secondary leaves **two** ground items.

---

## Phase 2 — Grenade cycling for humans (Nit #8)

Commit: `feat(gameplay): cycle carried grenades with repeated slot-4 presses`

File: `packages/server/src/room.ts`, `switchSlot()` (room.ts:787-796)

- Replace the early return `if (slot === p.activeSlot) return;` with: when `slot === 4 && p.activeSlot === 4 && p.nades.length > 1`, rotate the queue (`p.nades.push(p.nades.shift()!)`) and return; otherwise keep the early return.
- No client change needed: pressing `4` already sends `w: 4` on every fresh keypress (`pendingSlot` in GameScene), and the HUD already renders `nades[0]` as the pending throw (`THROW` + name, HudScene.ts:280-282) plus the full list in `nadeText`.
- Bots unaffected (verified): they only send `w: 4` once per throw sequence while holding a gun slot, so the rotate branch never triggers for them.
- Test in `room.test.ts`: buy smoke + flash + HE, press 4 twice (two separate inputs so edge detection fires), throw → detonated kind is the rotated one, remaining queue order correct.

---

## Phase 3 — Client bug fixes

Commit: `fix(client): stop chat input leaking hotkeys, join rooms on their actual map`

### 3.1 Chat hotkey leakage (Bug #2)
Files: `packages/client/src/scenes/GameScene.ts`, `packages/client/src/scenes/HudScene.ts`

Phaser's keyboard manager attaches to `window` at game boot — *before* `initChat()` registers its listener — so `stopPropagation`/`stopImmediatePropagation` in chat.ts cannot shield the game handlers. Fix with explicit `chatOpen` guards (the pattern already used for movement keys and `M`):

- GameScene: guard the `keydown-ONE/TWO/THREE/FOUR` handlers (GameScene.ts:126-129), `keydown-SPACE` (line 130), and the `[`/`]` team-switch handlers (lines 135-136) with `if (this.chatOpen) return;`.
- HudScene: it doesn't know chat state today. Subscribe to the existing `chat:toggle` game event (already emitted via `initChat` wiring in GameScene.create) in `HudScene.create()`, store a `chatOpen` flag, unsubscribe on shutdown alongside the other `game.events.off` calls (HudScene.ts:111-121). Guard `keydown-B` (line 94) and the TAB scoreboard display (line 95-99) with it — keep TAB's `preventDefault()` unconditional so typing TAB in chat doesn't move browser focus.

### 3.2 Lobby join hardcodes the map (Bug #3)
Files: `packages/client/src/menu.ts`, `packages/client/src/scenes/GameScene.ts`

- `menu.ts`: `renderRooms()` rows already have `r.map` — change the `onJoin` callback signature to `(code, map)` and have `join()` pass the listed map into `enterRoom()` instead of the hardcoded `'dust2'`. For the join-by-code path, look the code up in the most recent listing (keep the last fetched `rooms` array in a local); fall back to `'dust2'` if absent (fresh rooms are hidden from `list()` until the creator joins, so a lookup alone can't be complete).
- Safety net in GameScene `onWelcome` (GameScene.ts:168-171): the server's `welcome` message already carries the authoritative map name. If `msg.map !== session.map`, set `session.map = msg.map`, disconnect the current connection, `this.scene.stop('Hud')`, and `this.scene.restart()` — create() then rebuilds against the right map and reconnects. This covers every mismatch path (by-code joins to brand-new rooms, future maps) with one small guard.

---

## Phase 4 — Bot improvements

Commit: `feat(bots): burst-fire spray control per difficulty, no wasted utility budget`

File: `packages/server/src/bots/bot.ts`

### 4.1 Spray control difficulty parameter (Nit #7)
- Extend `DIFFICULTY_PARAMS` (bot.ts:19-23) with `burstTicks` / `pauseTicks`:
  - easy: effectively no control (e.g. `burstTicks: 9999, pauseTicks: 0`) — holds the trigger, bloom balloons;
  - normal: `~14 / ~10`; hard: `~8 / ~6` (short bursts, bloom recovers via `spreadDecay`).
- In `think()`'s engage branch (bot.ts:128): once the reaction gate passes, run a fire-cycle counter on the controller (`fireCycleTick`); suppress `BTN.ATTACK` during the pause window. Resolve the active weapon via the existing `activeWeapon(p)` export from room.ts:
  - **automatics** (`w.auto`): burst/pause per the difficulty params above;
  - **semi-autos** (`!w.auto`): use a short press/release toggle (e.g. 2 ticks on / 2 off) instead. This also fixes a confirmed latent bug: bots hold ATTACK continuously, and `tryFire`'s fresh-press check (room.ts:940) means semi-auto bots currently fire exactly **once per target sighting** — pistol-round bots are nearly harmless after their first shot.
- Reset the cycle counter when the target is lost.

### 4.2 Wasted throw budget (Nit #9)
- In `utilityThrow()` (bot.ts:164-179): add `if ((p.prevButtons & BTN.ATTACK) !== 0) return null;` before the spot loop, mirroring `throwGrenade()`'s fresh-press requirement — the bot no longer spends `throwsThisRound`/cooldown on an attempt the room will reject.

### 4.3 Verification
- `node scripts/integration-bots.mjs` must stay green (rounds complete, ≥1 nade throw). Watch a few rounds' logs to confirm kills still happen at all difficulties (spray control must not make bots harmless).

---

## Phase 5 — Client polish & UI

Commit: `feat(client): map callout labels, bot difficulty selector, fog-clipped tracers and muzzle flashes`

### 5.1 Callout labels (Nit #6)
File: `packages/client/src/render/mapRender.ts`

- After tile rendering, iterate `map.def.callouts` and add small monospace uppercase labels at `(tx + 0.5) * TILE_SIZE` centers: light gray, alpha ≈ 0.35, origin 0.5, depth between floor and players (players are depth 10; use ~2), non-interactive. Pure data-driven — dust2's 17 authored callouts light up with zero data changes.

### 5.2 Bot difficulty selector (Nit #5)
Files: `packages/client/index.html`, `packages/client/src/menu.ts`, `packages/server/src/index.ts`, `packages/server/src/roomManager.ts`

- `index.html`: add `<select id="menu-difficulty">` (Easy / Normal / Hard, default Normal) near the quick-play button.
- `menu.ts`: quick-play passes the selected difficulty in `botsRequested` (protocol already supports it — `FillBotsMsg.difficulty` is wired end-to-end); create-room includes it in the POST body.
- Server: accept `difficulty` in POST `/rooms` (validate against `['easy','normal','hard']`, default `'normal'`), store on `RoomMeta`, and use it for backfill bots in the ws close handler (`room.addBot(departedTeam, meta.difficulty)` in index.ts).

### 5.3 Fog-clip shot effects (Nit #11)
File: `packages/client/src/scenes/GameScene.ts`

- Create a third `GeometryMask` from the existing `visionGfx` (it already sources two masks; a graphics object can source many).
- Apply it to `tracerGfx` (created at GameScene.ts:107) and to each muzzle-flash image on creation (GameScene.ts:254-260).
- Own shots originate inside the polygon so self-feedback is unaffected; enemy tracers become visible only where they cross your vision — matching the "enemies outside the polygon aren't drawn" model.
- Deliberately **not** masking: smoke/fire zones, HE/flash pop circles, explosion glow, and all audio — these are area events whose sound already announces them (by-design info, per the sfx.ts comment). Note this choice in the commit body.

---

## Out of scope (unchanged from audit)
- Wallbangs, headshots, skins, ranked (out of scope per original plans).
- Rendering ground-item weapon identity (generic `grounditem` sprite stays).

## Verification (after each phase, and end-to-end at the finish)

1. `npm test` — all suites including the 3 new/extended `room.test.ts` cases.
2. `node scripts/integration-round.mjs` && `node scripts/integration-bots.mjs` — green.
3. `npm run build` — type-check + bundle clean.
4. Preview (`preview_start` per `.claude/launch.json`, server + client):
   - open chat, type `b4[` → no buy menu, no slot switch, no team change;
   - G-drop pistol, survive a round vs bots, confirm primary retained (HUD weapon text);
   - kill a bot carrying a bought pistol → two ground items drop;
   - press 4 repeatedly with multiple nades → HUD `THROW` name cycles;
   - callout labels visible on dust2 (screenshot);
   - enemy tracers/muzzle flashes no longer visible through walls (screenshot vs before);
   - quick-play with Easy and Hard bots → noticeably different fight behavior;
   - `preview_console_logs` clean.
5. Final: `npm run build && npm start`, play a match at `http://localhost:8090`.
