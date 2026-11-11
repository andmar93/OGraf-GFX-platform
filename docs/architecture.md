# Architecture

```
            ┌──────────────┐  HTTP /api/v1, /ograf/v1      ┌───────────────────────────────────┐
 Player ───▶│              │◀──────────────────────────────│ Companion / automation (Phase 6)  │
 Data tool ▶│    server    │                               └───────────────────────────────────┘
 Editor ───▶│  (data hub)  │── WebSocket /ws ──▶ renderer /render/main  (CasparCG / vMix / OBS)
            │              │── WebSocket /ws ──▶ renderer /render/main?preview=1 (player preview)
            └──────┬───────┘
                   │ SQLite (Drizzle) + package files in DATA_DIR
```

Everything goes through the server. Clients never talk to renderers directly.

## Server (`apps/server`)

| Module | Responsibility |
|---|---|
| `graphics/graphics.service.ts` | Import packages (zip/folder), validate with `ograf-core`, store content-addressed under `DATA_DIR/packages/<hash>/`, list/get/delete. A graphic id resolves to its **latest** upload. |
| `channels/channel.service.ts` | Authoritative channel and layer state. Every command (load, play, stop, update, custom, clear) updates state, persists it, broadcasts it and dispatches it to renderers. Resolves data bindings and pushes changes as partial `updateAction`s. |
| `renderers/gateway.ts` | WebSocket sessions (renderers and controllers), command dispatch with request ids and timeouts, time sync (ping/pong), heartbeats. |
| `data/data-hub.ts` | The data tree (`match.home.score`, …), persisted per top-level key. Clock helper. |
| `control/ograf-server-api.ts` | OGraf Server API adapter at `/ograf/v1`. |
| `control/internal-api.ts` | Our API at `/api/v1`: uploads, cue/take/next/out, data, clocks. |
| `rundowns/rundown.service.ts` + `control/rundown-api.ts` | Rundowns and items (SQLite), item control (cue/take/next/out/update) on top of the channel service, server-side cursor, out-then-in transitions, auto-out timers. |

### Channel model

- **Channel** = OGraf *Renderer* = one output (1920×1080, default 50 fps). The default channel `main` is created on first start.
- **Layer** = OGraf *RenderTarget* `{ "layer": n }` (0–999, higher draws on top). One graphic instance per layer, as in CasparCG.
- **Graphic instance** = a loaded graphic on a layer, identified by `graphicInstanceId`.

Layer state: `graphic`, `dataTemplate` (may contain bindings), `data` (resolved), `status`
(`loaded` | `playing` | `stopped`), `currentStep`, `error`.

### Command semantics

| Command | Effect |
|---|---|
| load / cue | Creates a new instance on the layer (replaces the old one), calls `load(data)` |
| take | With `graphicId`: load and then `playAction({goto: 0})`. Without: `goto 0` when not on air, else `delta 1` |
| play / next / prev | `playAction({goto})`, `{delta: 1}`, `{delta: -1}` (step rules from the spec, see `ograf-core/steps.ts`) |
| stop / out | `stopAction()` |
| update | Merges data into the template (or replaces it with `replace: true`) and sends the changed keys |
| custom | `customAction({id, payload})`; the id must exist in the manifest |
| clear | `dispose()`, then removes the instance |

State is updated **before** renderers answer: it is what the operator asked for. Renderer
results (errors, or the step a graphic reports for `stepCount: -1`) are written back afterwards,
unless a newer command for the same layer has been issued in the meantime.

Commands are **not** serialised per layer. The spec requires graphics to accept overlapping calls,
which keeps "out" instant even while an "in" animation is still running.

### Data bindings

Graphic data may contain bindings:

```json
{ "title": "Static text", "homeScore": { "$bind": "match.home.score", "default": 0 } }
```

When a data path changes, every layer with a binding that overlaps the changed path is re-resolved.
Only the top-level keys that actually changed are sent in one `updateAction` per layer; changes within
the same tick are coalesced. Graphics stay plain OGraf components.

### Rundowns

Items are played through the channel service, so there is one source of truth for what is on air. A layer loaded
from an item carries `source: { rundownId, itemId }`; clients derive item status (cued / on air / out) from the
channel state. The rundown's `cursorItemId` (the selected / "next" item) lives on the server so several operators
and automation see the same thing.

### Matches and the sports model

`packages/sports-model` is sport-agnostic: a match is its setup (teams, settings) plus an append-only event list.
The state is never stored – it is derived by replaying the events through the sport's plugin (`SportPlugin`:
`initialState`, `validate`, `reduce`, `publish`, `phaseActions`). Undo and edits are exact (replay without/with the
changed event) and the result is deterministic. Football is the first plugin (`sports/football`: periods, extra time,
event-driven clock, goals incl. own goals/penalties, cards with automatic second yellow, substitutions, VAR, stats and an
IFAB-style shootout). Hockey, handball, floorball … are new plugins registered with `registerSport()`; the core, the
server and the match API do not change.

The server (`matches/match.service.ts`) stores matches and events in SQLite, validates new/edited events with the
plugin and publishes the active match to the data hub as `match`. From there the usual binding mechanism updates the
graphics on air with partial `updateAction`s. The clock is a published anchor derived from the clock events – never ticks.

## Player (`apps/player`)

React + Vite, served at `/player`. One controller WebSocket feeds a small store (channels, data, rundowns);
all changes go through the REST API. The PVW preview loads the selected item into the renderer's `layer.html`
(same isolation as on air). See [player.md](player.md).

## Match data tool (`apps/data`)

React + Vite, served at `/data`, touch-first. It only talks to the match API and listens to `match.changed`;
everything shown (score, clock, log, shootout) comes from the server's `published` data. See [data-tool.md](data-tool.md).

## Editor (`apps/editor`, `packages/editor-core`)

`editor-core` holds the project model (layers: text, shape, image, group; data fields), the field → GDD schema
conversion, the exporter/importer and the **graphic runtime**: plain dependency-free JavaScript (a Web Component in
Shadow DOM with Web Animations) into which the exporter embeds the project JSON. Exported packages are therefore
ordinary OGraf graphics that run in any OGraf renderer.

The editor app renders its canvas with that same runtime inside the renderer's `layer.html` frame, driven through a
vendor method (`v_ogpEdit`) – so the canvas is pixel-identical to the output. Selection, moving, resizing and snapping
happen in an overlay computed from the model. Projects are stored on the server (`/api/v1/projects`); publishing
uploads the exported zip to the normal graphics import. See [editor.md](editor.md).

## Renderer (`apps/renderer`)

- `/render/:channelId` – stage at channel resolution, scaled to the window, transparent background.
- **One same-origin iframe per graphic instance** (`layer.html`). The graphic's DOM, CSS, globals,
  timers and errors stay inside it. Removing the iframe frees everything, even if `dispose()` misbehaves.
- `GraphicHost` (in `ograf-core`) wraps every call: exceptions become status 550, hanging calls time out
  (load 10 s, actions 5 s → 504), missing methods → 501, `undefined` → 200. Actions wait until `load()` resolves.
- Errors outside calls (timers, event handlers) are caught in the iframe and reported to the server (`renderer.layerError`).
- **Recovery**: on every (re)connect the server sends a snapshot. Instances that still exist are reconciled
  (data diff, step, stop) without reloading; missing ones are created and brought to their state with `skipAnimation`.
  While disconnected the renderer keeps showing what it has.
- **Heartbeat** every second; the server marks a renderer unresponsive after 5 s (visible in the channel state and the OGraf renderer `status`).

**Known limit:** iframes on the same origin share one JavaScript thread. A graphic stuck in an endless
synchronous loop freezes the whole renderer page. The server detects this (renderer unresponsive), but the
page must be reloaded from the host (e.g. re-PLAY the HTML producer in CasparCG, refresh the browser input in vMix or OBS).
After the reload the renderer restores everything from the server.

## Time and clocks

A clock is data, not a stream of ticks:

```json
{ "$type": "clock", "running": true, "anchorServerMs": 1731312000000, "elapsedAtAnchorMs": 1421000, "direction": "up", "limitMs": 2700000 }
```

- The server only publishes a new anchor on start, stop, set or adjust.
- Renderers estimate `offset = serverTime − localTime` (NTP style, best of the last 12 samples, re-synced every 10 s)
  and add `anchorLocalMs` to every clock value before passing data to a graphic. If the estimate shifts by more than 25 ms,
  clocks are re-sent with `skipAnimation`.
- Graphics compute `elapsed = elapsedAtAnchorMs + (running ? Date.now() − anchorLocalMs : 0)` on every animation frame.

This keeps clocks in sync across renderers on different machines and survives reloads with no drift.

## Storage

`DATA_DIR` (default `./data` in development, the `/data` volume in Docker):

- `ogp.sqlite` – packages, graphics, channels, layer state, data hub (Drizzle migrations in `apps/server/drizzle`)
- `packages/<contentHash>/…` – unpacked graphic packages, served at `/packages/…` with immutable caching

Deleting a graphic only unlists it by default, so graphics on air keep working. `?force=true` removes rows and unused files.
