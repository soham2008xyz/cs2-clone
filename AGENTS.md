# AGENTS.md

## Repo layout
- npm workspaces (ESM, `"type": "module"`), Node `>=22.22.2 <23`.
- `packages/shared`: pure TypeScript deterministic simulation + wire protocol. Source of truth (no Phaser/Node APIs). Exports from `src/index.ts`.
- `packages/server`: Node + `ws`. `RoomManager` hosts `Room`s (60Hz tick, 30Hz snapshots). Bots are players with `ws: null` and go through the exact same input path as network clients.
- `packages/client`: Phaser 3 + Vite (jsdom for tests). Client prediction + reconciliation for local player, snapshot interpolation for others, visibility-polygon fog of war.

## Commands
- `npm install`
- Dev: `npm run dev:server` (:8090 ws/http), `npm run dev:client` (:5173). Open the client in browser.
- Build: `npm run build` runs `@cs2d/client` build (Vite → `packages/client/dist/`) then `@cs2d/server` build (`tsc -p tsconfig.json`).
- Prod (single-server): `npm start` serves the built client from `packages/client/dist/` and the game/ws API on :8090. No Vite needed.
- Tests: `npm test` runs Vitest for shared + server + client. `npm run test:coverage` same. `npm run test:integration` runs `scripts/integration-round.mjs` (2-client round/economy/utility e2e) and `scripts/integration-bots.mjs` (5v5 bot-vs-bot autonomous).
- Typecheck (client only): `npm run typecheck -w @cs2d/client`.

## Architecture details (high signal)
- All game rules live in `shared/` (movement/collision/weapons+data/grenades/bomb/round/economy/vision/sim). Keep new rules/protocol there, not split across client/server.
- Network protocol types live under `packages/shared/src/net/` (snapshot + messages). Server broadcasts snapshots at 30Hz; sim ticks at 60Hz.
- Server pathfinding/bot FSM in `packages/server/src/bots/` (bots use the same input path as humans).
- Map authoring: add `MapDef` in `packages/shared/src/map/` (see `dust2.ts`, builder/compile), register in `registry.ts`. Client tilemap + server collision derive from the same grid.
- Client prediction/interpolation in `packages/client/src/net/` (prediction.ts, interpolation.ts). Fog/vision handled on client render.

## Build, CI, deploy quirks
- CI (`.github/workflows/test.yml`, Node 22): `npm ci --ignore-scripts` (esbuild postinstall skipped intentionally), runs `test:coverage`, client `typecheck`, `test:integration`, builds server then client. SonarCloud scan runs only if `SONAR_TOKEN` is set (PRs from forks skip).
- Render (`render.yaml`, free tier): `buildCommand` is `npm ci --include=dev && npm run build` (different from CI install), `startCommand: npm start`, `healthCheckPath: /rooms`, auto-deploy on `main`. Free sleeps after 15m idle (first request after idle can be slow).
- Single-server prod: server must be able to serve files from `packages/client/dist/` (built client). In dev, run server and Vite client separately.
- Coverage reports consumed by Sonar: `packages/*/coverage/lcov.info`. Sonar excludes `**/test/**`, `scripts/**`, `**/vite.config.ts`, `**/vitest.config.ts`.

## Development gotchas
- Prefer executable sources of truth (package.json scripts, CI, render.yaml) over prose when they conflict. `README.md` is the run reference.
- Vitest across all packages (`@vitest/coverage-v8`). Client uses `jsdom`. Shared is framework-free.
- Integration scripts are plain Node (`.mjs`) and spawn local processes; they are part of CI verification.
- Existing plans in `.claude/plans/` are detailed historical context (not required reading, but useful if making large structural changes).
- When extending, follow existing data-driven patterns (weapons/grenades stats are data in `weapons.data.ts`/`grenades.data.ts`, not embedded logic).