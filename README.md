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

### Single-server (production) mode

```bash
npm run build   # builds the client bundle and type-checks everything
npm start       # serves the built client AND the game API/ws on :8090
```

Then open <http://localhost:8090> — no Vite needed; one Node process runs
the whole game.

## Deployment

Deployed on [Render](https://render.com)'s free Web Service tier, configured
via `render.yaml` at the repo root — Render builds and runs the same
single-server production mode described above, so the one process serves
the client and the game/ws API from one URL. Pushing to `main` auto-deploys.

Free-tier caveat: the service sleeps after 15 minutes with no inbound
traffic, so the *first* request after a long idle period can take up to
about a minute to wake up. Once a room has active players, ongoing
WebSocket traffic keeps it awake — the slow case is specifically the
first connection after idle, not mid-game.

### Server limits

The server caps what one client can use. Each cap has an env override:

| Limit | Default | Env var |
| --- | --- | --- |
| Live rooms (`POST /rooms` gets `503` when full) | 50 | `CS2D_MAX_ROOMS` |
| Room creations per IP: burst / sustained per minute (`429` when over) | 10 / 6 | `CS2D_CREATE_BURST`, `CS2D_CREATE_PER_MIN` |
| Players per room, bots included (join closes with code `4003`) | 10 | none |
| Per-connection messages: inputs 120/s (burst 60), chat 3/s (burst 5), the rest 10/s | | none |

`x-forwarded-for` is read only when `CS2D_TRUSTED_PROXY_HOPS` is above 0. It defaults to 1 on Render (which sets `RENDER`) and 0 elsewhere.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Walk (quieter, no movement inaccuracy) |
| Mouse | Aim / hold to fire |
| R | Reload |
| E | Use (plant / defuse / pick up dropped weapon — walking over one also picks it up if the slot is free) |
| G | Drop the held gun |
| 1 / 2 / 3 / 4 | Primary / secondary / knife / grenade |
| B | Buy menu (freezetime or first 20s of a round, inside your buy zone) |
| M | Mute sound |
| Tab (hold) | Scoreboard |
| Space | Cycle spectate target after death |
| [ / ] | Join T / CT (lobby only, before the match starts) |
| Enter | Chat |

Buy extras: **Kevlar** ($650) absorbs damage, **Helmet** ($350, requires
kevlar) makes that armor absorb 15% more, and CTs can buy a **Defuse Kit**
($400, halves defuse time).

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
