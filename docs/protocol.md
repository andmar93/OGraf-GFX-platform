# APIs and protocol

All responses are JSON. Errors use RFC 7807 problem details:
`{ "type": "about:blank", "title": "...", "status": 404, "instance": "/api/v1/...", "details": ... }`.
CORS is open (`*`). There is no authentication: the system is meant for a closed production LAN.

## OGraf Server API – `/ograf/v1`

Follows the EBU OpenAPI definition (`v1/specification/open-api/server-api.yaml`):

| Method & path | Notes |
|---|---|
| `GET /ograf/v1/` | Server info |
| `GET /ograf/v1/graphics` | `{ graphics: GraphicListInfo[] }` (latest version of each graphic) |
| `GET /ograf/v1/graphics/{graphicId}` | `{ graphic: <manifest>, metadata: { createdAt } }` |
| `DELETE /ograf/v1/graphics/{graphicId}[?force=true]` | Unlist (or remove) |
| `GET /ograf/v1/graphics/{graphicId}/thumbnail?file=…` | Redirects to the file (must be listed in `thumbnails`) |
| `GET /ograf/v1/renderers` | Channels |
| `GET /ograf/v1/renderers/{id}` | `renderCharacteristics`, `renderTargetSchema` (`{ layer: integer }`), `status`, `renderTargets` |
| `GET /ograf/v1/renderers/{id}/target?renderTarget={"layer":10}` | Instances on a layer |
| `PUT …/target/graphicInstance/clear` | `{ filters: [{ renderTarget?, graphicId?, graphicInstanceId? }] }`; empty = all |
| `POST …/target/graphicInstance/load` | `{ renderTarget, graphicId, params: { data } }` → `{ graphicInstanceId, statusCode }` |
| `POST …/target/graphicInstance/playAction` | `{ renderTarget, graphicInstanceId, params: { goto?, delta?, skipAnimation? } }` |
| `POST …/target/graphicInstance/stopAction` | `{ …, params: { skipAnimation? } }` |
| `POST …/target/graphicInstance/updateAction` | `{ …, params: { data, skipAnimation? } }` |
| `POST …/target/graphicInstance/customActions/{id}` | `{ …, params: { payload, skipAnimation? } }` |

Status mapping: the status code a graphic returns is passed through in the body (HTTP 200). Errors thrown inside the
graphic, timeouts and unimplemented methods → **HTTP 550**. A renderer that is unreachable or does not answer → **HTTP 500**.
When no renderer is connected the command is stored in state and answered with `statusCode: 200`
(`v_ogp_rendererCount: 0`). Data that fails the manifest schema is still sent; warnings are returned in `v_ogp_dataWarnings`.

## Internal API – `/api/v1`

### Graphics
| | |
|---|---|
| `GET /api/v1/graphics` | Graphics with `mainUrl`, `stepCount`, `schema`, `customActions`, thumbnails |
| `GET /api/v1/graphics/{id}` | |
| `POST /api/v1/graphics[?force=true]` | Upload a zip: `multipart/form-data` (field `file`) or raw body with `Content-Type: application/zip`. 201 = new, 200 = identical package already imported, 400 = invalid (details per manifest). `force` imports only the valid graphics. |
| `DELETE /api/v1/graphics/{id}[?force=true]` | |

### Channels and layers
| | |
|---|---|
| `GET /api/v1/channels` / `POST` `{ name, id?, description?, frameRate? }` | |
| `GET/PATCH/DELETE /api/v1/channels/{ch}` | |
| `POST /api/v1/channels/{ch}/clear` | Clear all layers |
| `POST /api/v1/channels/{ch}/out-all` | `stopAction` on every playing layer |
| `POST /api/v1/channels/{ch}/reload-renderers` | Ask renderer pages to reload |
| `GET /api/v1/channels/{ch}/layers/{n}` | Layer state |
| `POST …/layers/{n}/load` (alias `cue`) | `{ graphicId, data? }` |
| `POST …/layers/{n}/take` | `{ graphicId?, data?, skipAnimation? }` |
| `POST …/layers/{n}/play` | `{ goto?, delta?, skipAnimation? }` |
| `POST …/layers/{n}/next` · `prev` · `stop` (alias `out`) · `clear` | `{ skipAnimation? }` |
| `POST …/layers/{n}/update` | `{ data, replace?, skipAnimation? }` |
| `POST …/layers/{n}/custom/{actionId}` | `{ payload?, skipAnimation? }` |

Layer commands return `{ statusCode, statusMessage?, result?, currentStep?, graphicInstanceId, rendererCount, dataWarnings? }`.

### Rundowns
| | |
|---|---|
| `GET /api/v1/rundowns` / `POST { name }` | List (summaries) / create |
| `GET/PATCH/DELETE /api/v1/rundowns/{id}` | `PATCH { name?, cursorItemId? }` |
| `POST /api/v1/rundowns/{id}/duplicate` | `{ name? }` |
| `POST /api/v1/rundowns/{id}/reorder` | `{ itemIds: [...] }` (all items, new order) |
| `POST /api/v1/rundowns/{id}/take` | Take the cursor item → `{ itemId, statusCode, … }` |
| `POST /api/v1/rundowns/{id}/items` | `{ graphicId, name?, channelId?, layer?, data?, durationMs?, afterItemId? }`. Defaults: first channel, manifest `v_ogp_defaultLayer` (else 20), schema defaults with `v_ogp_bind` hints as bindings. |
| `GET/PATCH/DELETE /api/v1/rundowns/{id}/items/{itemId}` | `PATCH` any of the fields above |
| `POST …/items/{itemId}/duplicate` | Inserted after the item |
| `POST …/items/{itemId}/{cue\|take\|next\|prev\|out\|update\|clear}` | `{ skipAnimation?, advance? (take, default true), transition? ('out-in' default \| 'cut') }` → command outcome + `cursorItemId`. `next/prev/out/update/clear` return 409 when the item is not loaded. |
| `POST …/items/{itemId}/custom/{actionId}` | `{ payload }` |

Take semantics: not loaded → (animate out what is on the layer, unless `transition: 'cut'`) load + play step 0;
cued → bring data up to date, play step 0; on air → next step for multi-step graphics, otherwise no-op.
Items with `durationMs` are taken out automatically after that time.

### Matches (data tool)
| | |
|---|---|
| `GET /api/v1/sports` | Available sports, default settings and event types |
| `GET /api/v1/matches` / `POST { name?, sport?, home?, away?, settings? }` | List / create |
| `GET /api/v1/matches/active` | The active match or `null` |
| `GET/PATCH/DELETE /api/v1/matches/{id}` | `PATCH { name?, home?, away?, settings? }` (teams are normalised; an automatic name follows the team names) |
| `POST /api/v1/matches/{id}/activate` · `POST /api/v1/matches/deactivate` | The active match is published as `match.*` |
| `POST /api/v1/matches/{id}/events` | `{ type, team?, data? }` → 201, or 422 with the reason when the event is not allowed now |
| `PATCH/DELETE /api/v1/matches/{id}/events/{eventId}` | Edit (`{ team?, data? }`, `null` removes a data key, re-validated) / delete |
| `POST /api/v1/matches/{id}/undo` · `/redo` | Undo removes the last event; redo restores it (until a new event is added) |

A match response contains the setup, `events`, `published` (exactly what goes to `match.*`), `actions`
(next phase transitions) and `canUndo` / `canRedo`. Football event types: `period.start/end {period: H1|H2|ET1|ET2|PEN, first?}`,
`match.end`, `clock.start`, `clock.stop`, `clock.set {elapsedMs}`, `clock.adjust {deltaMs}`, `added_time {minutes}`,
`goal {kind: normal|penalty|own_goal, playerId?, assistId?, minute?}`, `card {card: yellow|red, playerId?}`,
`substitution {outId, inId}`, `var {reason, decision}`, `corner`, `shot {onTarget?}`, `foul`, `offside`,
`shootout.kick {scored, playerId?}`.

### Assets
| | |
|---|---|
| `POST /api/v1/assets` | Image upload (multipart, field `file`; PNG, JPG, GIF, WebP, SVG; max 10 MB) → `{ url: "/assets/<hash>.<ext>" }` |

### Data hub
| | |
|---|---|
| `GET /api/v1/data` | Whole tree |
| `GET/PUT/PATCH/DELETE /api/v1/data/{path}` | Path with `/` or `.` (`match/home/score` = `match.home.score`). `PUT` body = the JSON value (also numbers or strings). `PATCH` deep-merges, `null` deletes a key. |
| `POST /api/v1/clock/{start\|stop\|toggle\|set\|adjust\|reset}` | `{ path, elapsedMs?, adjustMs?, direction?, limitMs?, label? }` |

## WebSocket – `/ws`

JSON messages. Types are defined in `packages/protocol/src/messages.ts`.

Client → server:

| Message | |
|---|---|
| `{ type: "hello", role: "renderer", channelId, preview? }` | Renderer. Answered with `welcome` + `renderer.snapshot`. Preview renderers receive commands but their results do not count. |
| `{ type: "hello", role: "controller", channels?, data? }` | UI client. Receives `channel.state` for all (or the given) channels and `data.changed` for the given path prefixes (`""` = all). |
| `{ type: "time.ping", t0 }` | → `{ type: "time.pong", t0, serverTime }` |
| `{ type: "renderer.result", reqId, result }` | Answer to `renderer.command` |
| `{ type: "renderer.layerError", layer, graphicInstanceId, message }` | Asynchronous error in a graphic |
| `{ type: "renderer.heartbeat" }` | Every second |

Server → client: `welcome`, `error`, `time.pong`, `renderer.snapshot`, `renderer.command`
(`{ reqId, command: { action, layer, graphicInstanceId, graphic?, params } }`), `renderer.reload`,
`channel.state`, `channel.removed`, `data.changed`, `graphics.changed`, `rundown.changed` (full rundown),
`rundown.removed`, `rundowns.changed` (summaries), `match.changed` (full match), `match.removed`, `matches.changed`.

Layer state includes `source: { rundownId, itemId }` when the instance was loaded from a rundown item, and
`onAirSince` (server time) while playing.
