# CS2D

A 2D top-down Counter-Strike clone (GTA-1/2 style camera) with MR12 rounds,
economy, utility, bots, and online multiplayer. Built with Phaser 3 + Vite
(client), Node.js + ws (server), and a shared pure-TypeScript simulation
package used by both.

## Running locally

```bash
npm install
npm run dev:server   # http/ws on :8090
npm run dev:client   # browser client on :5173 (open this in your browser)
```

Open the client, pick a name, and either **Quick Match vs Bots**, **Create
Room** (share the 4-letter code with a friend), or **Join Room** with a code.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Walk (quieter, no movement inaccuracy) |
| Mouse | Aim / hold to fire |
| R | Reload |
| E | Use (plant / defuse / pick up dropped weapon) |
| 1 / 2 / 3 / 4 | Primary / secondary / knife / grenade |
| B | Buy menu (during freezetime or the first 20s of a round) |
| Tab (hold) | Scoreboard |
| Space | Cycle spectate target after death |
| [ / ] | Join T / CT (lobby only, before the match starts) |
| Enter | Chat |

## Testing

```bash
npm test                              # shared + server unit tests
node scripts/integration-round.mjs    # 2-client round/economy/utility e2e test
node scripts/integration-bots.mjs     # 5v5 bot-vs-bot autonomous play test
```

## Architecture

- `packages/shared` — pure-TS deterministic simulation (movement, combat,
  economy, round/match rules, grenades, map format) and the wire protocol.
  Both the server (authoritative) and client (prediction) run this same code.
- `packages/server` — Node + `ws`. A `RoomManager` hosts many concurrent
  `Room` instances (one per match), each ticking at 60Hz and broadcasting
  snapshots at 30Hz. Bots are regular players (`ws: null`) driven by a
  server-side FSM through the exact same input path a network client uses.
- `packages/client` — Phaser 3 scenes (Boot/Game/Hud) plus an HTML menu
  overlay for room list/create/join and chat (more reliable text input than
  a Phaser text field). Client-side prediction + reconciliation for the
  local player, snapshot interpolation for everyone else, and a visibility-
  polygon fog of war so the top-down camera doesn't reveal enemies through
  walls.

## Extending

- **New maps**: add a `MapDef` under `packages/shared/src/map/` (see
  `dust2.ts` for the carve-based authoring pattern) and register it in
  `registry.ts`. The client tilemap and server collision both derive from
  the same grid automatically.
- **New weapons/grenades**: add an entry to `weapons.data.ts` /
  `grenades.data.ts` — price, damage, and stats are data, not code.
