# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` has the repo layout, CI and deploy quirks. Read it too. `README.md` is the run reference and lists the in-game controls.

## Commands

Node `>=24.15.0 <25`, npm workspaces (`@cs2d/shared`, `@cs2d/server`, `@cs2d/client`).

```bash
npm install
npm run dev:server        # tsx watch, http + ws on :8090
npm run dev:client        # Vite on :5173 (open this one in the browser)
npm run build             # client (Vite → packages/client/dist) then server (tsc)
npm start                 # single process: serves built client + game API on :8090

npm test                  # vitest in shared, server, client (in that order)
npm run test:coverage     # same, with lcov for Sonar
npm run test:integration  # scripts/integration-round.mjs + integration-bots.mjs (spawn a real server)
npm run typecheck             # tsc --noEmit over src + test in all three packages
```

Run one package, file or test:

```bash
npm test -w @cs2d/server
npm test -w @cs2d/server -- test/room-fire.test.ts
npm test -w @cs2d/shared -- -t "name substring"
npm run test:watch -w @cs2d/shared    # watch mode (shared only)
```

There is no linter or formatter script. Only `.editorconfig` applies.

Other scripts:
- `scripts/headless-client.mjs [name] [sec] [roomCode]` joins a room as a scripted player. It helps test netcode with a second player.
- `scripts/fetch-assets.mjs` downloads the optional Kenney sprites into `packages/client/public/assets/`. The game falls back to procedural textures without them.
- `CS2D_FAST=1` makes the server use short round timings. The integration scripts rely on it.

## Architecture

The core idea: **`packages/shared` is a deterministic, dependency-free simulation that the server and the client both run.** Server and client import it as TypeScript source (`"exports": "./src/index.ts"`, no build step), and everything public goes through `shared/src/index.ts`. A rule that touches movement, combat, economy, vision or the protocol belongs in `shared/`. Split it between server and client and prediction drifts from the authoritative result.

### Data flow

1. **Client → server** (`shared/src/net/protocol.ts`). JSON messages, with a `t` discriminator and short keys to keep them small. `InputMsg` carries a sequence number `s`, a `BTN` bitmask `b`, an aim angle `a`, and `k`, the latest server tick the client has seen.
2. **Server tick** (`Room.step()` in `server/src/room.ts`, 60Hz):
   - advance the match phase
   - run the bot FSMs
   - update each player
   - update grenades, pickups and win conditions
   - record positions in the lag compensator
   - every 2nd tick, send a snapshot (30Hz)
3. **Server → client.** `SnapshotMsg` holds players as positional tuples (`PlayerSnap`, `GroundItem`, `NadeSnap`, `ZoneSnap`), `a` (the last input seq processed for this client), per-client private state `me` (`SelfState`), and one-shot `ev` events. Adding a field means editing the `protocol.ts` types, the server's `broadcastSnapshot`, and the client's consumers.

### Server (`packages/server`)

- `app.ts` (`startServer`, started by the thin `index.ts`) is plain `node:http` plus `ws`. It serves `GET /rooms` (the Render health check) and `POST /rooms`, upgrades websockets with `?room=CODE`, and serves the built client for any other GET with an SPA fallback.
- `RoomManager` creates and reaps `Room`s, which have 4-letter codes. `Room` (about 1300 lines) owns everything per match: phases (`waiting → freeze → live → planted → round_end → match_end`), economy, buy rules, bomb, grenades and zones, drops and pickups, and snapshots.
- Bots (`bots/`) are `PlayerConn`s with `ws: null`. `bot.think()` produces the same `InputMsg`s a client sends, and they go through `Room.handleInput`. Never give bots a side door into state. `pathfinding.ts` works on the compiled map grid.
- `lagcomp.ts` keeps one second of positions. On a shot, `Room` rewinds targets to `clientSeenTick − INTERP_DELAY_TICKS`, so hits match what the shooter saw.

### Client (`packages/client`)

- Phaser scenes: `BootScene` → `GameScene` (world, input, networking glue; the biggest file) + `HudScene` (overlay). The room list, create/join and chat are an HTML overlay (`menu.ts`, `chat.ts`), not Phaser.
- `net/prediction.ts`: `Predictor` applies each input locally with the shared `stepMovement`, then on each snapshot resets to the server position and replays inputs newer than `ack`. `net/interpolation.ts` renders remote players about `INTERP_DELAY_MS` in the past.
- `net/api.ts` and `net/connection.ts` assume the server is on `:8090` when the page is on `:5173` (dev). Otherwise they use the page origin (prod single-server).
- Fog of war is a visibility polygon from `shared/sim/vision.ts`, drawn client-side. Smoke zones block it. The server also filters each snapshot per recipient (`broadcastSnapshot`, `server/src/visibility.ts`), so hidden enemies never reach the client.

### Maps

A `MapDef` (`shared/src/map/`) is compiled once by `compile.ts` into a `CompiledMap` grid. The server uses it for collision and pathfinding, and the client uses it for the tilemap and prediction. `dust2.ts` shows the carve-based authoring pattern. `testarena.ts` is the small map the integration tests use. Register new maps in `registry.ts`.

### Data-driven content

Weapon and grenade stats live in `weapons.data.ts` and `grenades.data.ts`. Add or tune entries there, and keep behavior in the sim modules. Both data files have tests that check their invariants.

## Testing notes

- Server tests drive `Room` directly (see `server/test/room*.test.ts`). Look at the helpers there before writing new ones.
- Client tests run under jsdom with hand-written Phaser fakes (`client/test/phaserFakes.ts`), because Phaser needs a real canvas. Extend the fakes if a new scene test needs more Phaser surface.
- `.claude/plans/*.md` hold past audit and fix plans. They are history, not current instructions.
