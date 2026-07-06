# CS2 Clone — 2D Top-Down Counter-Strike (Plan)

## Context

Greenfield project in an empty directory (`/Users/sohambanerjee/Workspaces/Personal/cs2-clone`, not yet a git repo). Goal: a playable 2D top-down Counter-Strike clone (early-GTA camera) with faithful CS2 rules — MR12, 1:55 rounds, plant/defuse, economy, utility, 5v5 — playable both PvE (bots) and online PvP.

**Locked decisions (user-confirmed):**
- **Stack:** TypeScript everywhere. Browser client, authoritative Node.js WebSocket server.
- **Client:** Phaser 3 (+ Vite dev/build).
- **Art:** Kenney CC0 asset packs (top-down shooter sprites, particles), downloaded during implementation; procedural fallback if downloads fail.
- **Delivery:** Full build in phased, individually-verified milestones.

## Architecture

npm-workspaces monorepo. The load-bearing decision: **all game logic lives in a pure-TS `shared` package** (no Phaser, no Node APIs). The server runs it as the source of truth; the client runs the same code for client-side prediction. Phaser only renders, plays audio, and captures input.

```
cs2-clone/
├── package.json                 # npm workspaces: shared, server, client
├── packages/
│   ├── shared/                  # deterministic sim + protocol (pure TS, Vitest tests)
│   │   └── src/
│   │       ├── constants.ts     # economy values, timings, tick rate
│   │       ├── math.ts          # vec2, raycast, circle/AABB helpers
│   │       ├── map/             # types.ts (MapDef), dust2.ts, registry.ts (extensible)
│   │       ├── sim/             # state.ts, movement.ts, collision.ts,
│   │       │                    # weapons.ts + weapons.data.ts, grenades.ts,
│   │       │                    # vision.ts, bomb.ts, economy.ts, round.ts, sim.ts
│   │       └── net/protocol.ts  # message types C↔S, snapshot shape
│   ├── server/                  # Node + ws
│   │   └── src/
│   │       ├── index.ts         # http (serves built client) + ws, room manager
│   │       ├── room.ts          # one match: tick loop, snapshots, lag compensation
│   │       ├── lagcomp.ts       # position history ring buffer + rewind
│   │       └── bots/            # pathfinding.ts (A* on tile grid), bot.ts (FSM), buy.ts
│   └── client/                  # Phaser 3 + Vite
│       └── src/
│           ├── scenes/          # Boot, Menu, Game, Hud (overlay scene)
│           ├── net/             # connection.ts, prediction.ts, interpolation.ts
│           ├── render/          # players, tracers, grenades, smoke, fire, vision mask
│           └── audio/           # WebAudio synth + Kenney samples
└── docs/superpowers/specs/      # this design doc, committed
```

### Simulation model
- Fixed timestep **60 Hz** simulation tick on the server; snapshots broadcast at **30 Hz** (JSON over ws — fine at this scale; binary is a noted future optimization).
- **Client prediction:** client applies its own inputs immediately via shared movement code; server echoes `lastProcessedSeq`; client reconciles (rewind + replay pending inputs). Remote players render **~100 ms behind** via snapshot interpolation.
- **Lag compensation:** server keeps ~1 s of per-player position history; hitscan shots rewind hitboxes to the shooter's interpolated time.
- **PvE uses the same path as PvP:** the menu's "Play vs Bots" creates a room on the local server filled with bots. One code path, no offline fork.

### Vision / fog of war (required for the game to make sense in 2D)
Top-down would otherwise be a wallhack. Client computes a **visibility polygon** (raycasts against wall segments + active smoke circles) and masks the world with it (Phaser Graphics geometry mask). Enemies outside the polygon aren't drawn. Smokes are LOS occluders, so smoke plays exactly like CS. Bots use the same shared LOS check.

## Game rules (CS2-faithful)

- **MR12:** first to 13; side swap after round 12; pistol rounds at 1 and 13.
- **Overtime** at 12-12: MR3 halves (best of 6), everyone gets **$10,000 at each OT half start**, win by reaching 4 in an OT else next OT at 3-3.
- **Timings:** freezetime 15 s → round 1:55 → bomb timer 40 s (round timer hides on plant), plant 3.2 s, defuse 10 s / 5 s with kit, round-end phase 7 s.
- **Win conditions:** T elimination, CT elimination (only if bomb not planted), bomb explodes, bomb defused, time expires (CT win). Post-plant: killing all Ts does **not** end the round — CTs must defuse.
- **Economy:** start $800, cap $16,000. Kill rewards by weapon class (rifle/pistol $300, SMG $600, knife $1500). Round win $3,250 (elimination) / $3,500 (defuse or detonation). CS2-style **dynamic loss bonus:** $1,400→$1,900→$2,400→$2,900→$3,400 ladder; a win decrements the counter by 1 (doesn't reset it). Ts who planted but lost get +$800. Money resets to $800 at halftime, $10,000 in OT.
- **Buy system:** buy zones + freezetime/first-20 s window. Roster — T: Glock, Deagle, MAC-10, Galil, AK-47; CT: USP-S, Deagle, MP9, FAMAS, M4A4. Kevlar $650 / +helmet $350, defuse kit $400 (CT), HE $300, flash $200 (max 2), smoke $300, molotov $400 / incendiary $500. Max 4 grenades. G drops weapon; dead players drop guns + bomb; E picks up / plants / defuses.
- **Weapons:** hitscan; data-driven table (damage, RPM, magazine/reserve, reload time, move-speed multiplier, base spread + movement inaccuracy + spray recoil growth, range falloff, price, kill reward). Armor reduces damage flat (no headshots in 2D — deliberate simplification). Friendly fire off by default (config flag).
- **Utility:** thrown projectiles with wall-bounce physics.
  - **Smoke:** blooms to a circle on rest, blocks LOS 18 s.
  - **Flash:** 1.6 s fuse; blind amount = f(LOS to pop point, facing angle); white overlay + fade; blinds bots too (accuracy/reaction penalty).
  - **HE:** radial LOS-checked damage with falloff, armor-reduced.
  - **Molotov/Incendiary:** fire area 7 s, ~40 dps, area denial; bots path around it.
- Explicitly out of scope for v1 (noted extension points): wallbang penetration, headshots, weapon skins, ranked matchmaking.

## Map: Dust 2 (extensible format)

`MapDef` = tile grid (~96×72 @ 32 px tiles: wall/floor variants) + metadata: spawn points per team, two bomb sites (A/B zones), buy zones, callout labels (Long, Catwalk, Mid, Tunnels, etc.). Authored as a char-grid in `dust2.ts` capturing the real layout topology: T spawn → Long/Mid/Tunnels; CT spawn between sites; classic chokes (Long doors, mid doors, B tunnels). Registry keyed by name so new maps are one file + one registration. Client builds a Phaser tilemap from the same data.

## Bots (server-side)

- **Pathfinding:** A* over walkable tiles, path smoothing via LOS checks.
- **FSM behaviors:** buy (money-aware) → navigate (T: pick a site, execute, plant; CT: defend assigned site, rotate on info) → engage (LOS-triggered, difficulty-scaled reaction time + aim error) → post-plant (T: hold site; CT: retake and defuse, checking for defenders) → retreat/save at low HP with gun advantage lost.
- Difficulty presets (easy/normal/hard) tune reaction ms, aim jitter, spray control.
- Basic utility use: throw smoke/flash at the choke they're pushing (per-map anchor points in MapDef).

## Assets & audio

- Download Kenney **Top-Down Shooter** + **Particle Pack** (CC0) zips from kenney.nl via curl in Phase 1; commit needed subsets to `packages/client/public/assets/`. Sand/stone tiles fit Dust 2's palette.
- If downloads fail: generate placeholder sprite sheets procedurally (canvas-drawn PNGs via a Node script) with identical filenames, so the game is never blocked on assets.
- **Audio:** ZzFX-style WebAudio synthesis for gunshots/UI/beeps (zero assets, per-weapon parameter tweaks), Kenney audio samples where suitable. Bomb beep accelerates near detonation.

## Phases (each ends verified & git-committed)

1. **Scaffold + walkable Dust 2** — monorepo, git init, Vite+Phaser client, Node server skeleton, shared package with map format + movement/collision; asset download; single local player walks Dust 2 with camera follow. *Verify: run dev server, screenshot via preview tools, unit tests for collision.*
2. **Netcode core** — ws protocol, server tick loop, join flow, prediction/reconciliation, interpolation. *Verify: two browser tabs see each other move smoothly; jest-style sim tests for reconciliation.*
3. **Combat** — weapon data + hitscan + spread/recoil, lag comp, damage/death/respawn-for-testing, vision polygon + fog, killfeed + basic HUD (hp/ammo/money). *Verify: tab-vs-tab duel; unit tests for damage falloff, armor math, LOS.*
4. **Rounds, economy, objectives** — full round state machine, freezetime, buy menu UI, MR12 + halftime + OT, bomb carry/plant/defuse, post-plant logic, win conditions, scoreboard, spectate-teammates-on-death. *Verify: unit tests for the state machine + economy ladder (most test-dense phase); scripted 2-client round end-to-end.*
5. **Utility** — grenade physics, smoke (LOS occluder), flash (blind calc), HE, molotov; particles + rendering + synth audio. *Verify: unit tests for bounce/blind/damage math; visual check of each nade.*
6. **Bots / PvE** — A*, FSM, difficulties, "Play vs Bots" fills a room to 5v5. *Verify: watch a full bot-vs-bot match complete with plants/defuses/OT-capable scoring; server logs assert round flow.*
7. **Multiplayer polish** — menu: lobby list, create/join by room code, team select, auto-balance, bot backfill toggle, player names, ping display, chat, end-of-match screen. Final QA sweep. *Verify: full 2-human + 8-bot match over LAN.*

## Verification strategy

- **Unit tests (Vitest) on `shared`:** economy ladder, round state machine (incl. MR12/halftime/OT edges, post-plant rules), weapon math, movement collision, grenade bounces, blind calculation, lag-comp rewind. This is where CS-rules correctness lives — cheap to test because the sim is pure.
- **Integration:** headless ws clients script a full round against the real server.
- **Manual/visual:** Claude Preview tools (launch server, screenshot, console logs) at every phase; final human playtest instructions in README.
- Git commit after every working milestone (conventional commits, per global CLAUDE.md).
