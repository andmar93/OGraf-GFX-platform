# OGraf GFX Platform

A broadcast graphics system built on the **EBU OGraf v1** specification
([ograf.ebu.io](https://ograf.ebu.io), [github.com/ebu/ograf](https://github.com/ebu/ograf)).
Graphics are standard OGraf packages (manifest + Web Component), rendered in a transparent
1920×1080 page that works as an input in **CasparCG** (HTML producer), **vMix** (Web Browser input) and **OBS** (Browser Source).

> **Status: Phase 5** – server, renderer, example graphics, the **player**, the football **match data tool** and the
> **graphics editor** (layers, data binding, a keyframe **timeline** with in/steps/out, multi-select, align and groups,
> publish to the library). The Companion API and polish (6) follow.

## Quick start

### With Docker (one command)

```bash
docker compose up --build
```

### For development

Requires Node.js ≥ 22.12 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev          # builds the renderer, then runs server (watch) + renderer (watch)
```

Then open:

| URL | What |
|---|---|
| http://localhost:8080/player/ | **Player** – the operator UI (see [docs/player.md](docs/player.md)) |
| http://localhost:8080/data/ | **Match data tool** – teams, clock and events (see [docs/data-tool.md](docs/data-tool.md)) |
| http://localhost:8080/editor/ | **Graphics editor** – build graphics and publish them to the library (see [docs/editor.md](docs/editor.md)) |
| http://localhost:8080/dev | Test bench: raw layer control and data |
| http://localhost:8080/render/main | **Renderer** for channel `main` – use this URL in CasparCG / vMix / OBS |
| http://localhost:8080/render/main?debug=1&bg=checker | Renderer with status overlay and checkerboard background |
| http://localhost:8080/ograf/v1/ | OGraf Server API |
| http://localhost:8080/api/v1/health | Internal API |

See [docs/renderer-setup.md](docs/renderer-setup.md) for CasparCG, vMix and OBS settings, and
[docs/phase5-testing.md](docs/phase5-testing.md) for a step-by-step test script.

## Repository layout

```
packages/
  ograf-core/   OGraf manifest types, schema validation (official EBU JSON schemas, vendored),
                GDD helpers, step model, GraphicHost (safe Web Component wrapper), package reader
  protocol/     Shared WebSocket messages, channel state, clock anchors, data paths & bindings
  sports-model/ Sport-agnostic, event-sourced match model; one plugin per sport (football)
  editor-core/  Editor project model, OGraf exporter/importer and the dependency-free graphic runtime
apps/
  server/       Fastify + WebSocket + SQLite (Drizzle). Graphics store, channels, renderer gateway,
                data hub, OGraf Server API adapter (/ograf/v1), internal API (/api/v1), /dev test bench
  renderer/     /render/:channelId – transparent stage, one iframe per layer, recovers after reload
  player/       /player – operator UI (React): rundowns, cue/take/next/out, live data, PGM/PVW previews
  data/         /data – football match data tool (React, touch-first)
  editor/       /editor – graphics editor (React): canvas, layers, properties, data fields, publish
graphics/       Example OGraf packages (lower third, scorebug with clock, full-frame lineup, event banner)
tools/          validate-graphics, pack-graphic
docs/           Architecture, protocol, player guide, renderer setup, authoring guide, test scripts
```

## Scripts

| Command | |
|---|---|
| `pnpm dev` | Development: server and all web apps in watch mode |
| `pnpm test` | All tests (ograf-core, protocol, renderer, server) |
| `pnpm typecheck` | TypeScript checks for all packages |
| `pnpm build` | Production build (renderer → `apps/renderer/dist`, server → `apps/server/dist`) |
| `pnpm start` | Run the production server build |
| `pnpm validate:graphics [paths…]` | Validate OGraf packages (folders or zips) |
| `pnpm pack:graphics` | Zip `graphics/*` into `dist-graphics/*.zip` for upload |
| `pnpm sync-schemas` | Refresh the vendored OGraf JSON schemas from GitHub |

## Key ideas

- **Standard graphics.** Graphics never talk to our server. The server resolves data bindings
  (`{ "$bind": "match.home.score" }`) and calls the standard `updateAction()`. Any OGraf graphic works.
- **The server owns state.** Every command updates the authoritative channel state first. A renderer that
  reloads or reconnects gets a snapshot and rebuilds itself (with `skipAnimation`) – no flicker for instances it still has.
- **Faulty graphics are isolated.** Each graphic runs in its own iframe, every call is wrapped (errors and timeouts become
  status codes), and clearing a layer removes the iframe with everything the graphic left behind.
- **Clocks are anchors, not ticks.** A clock value is `{ running, anchorServerMs, elapsedAtAnchorMs }`; renderers
  measure their offset to server time and graphics compute the time locally on every frame.
- **Close to the OGraf Server API.** `/ograf/v1` follows the EBU OpenAPI (renderer = channel,
  render target = `{ "layer": n }`), behind an adapter so it can follow the spec as it evolves.

More in [docs/architecture.md](docs/architecture.md) and [docs/protocol.md](docs/protocol.md).
