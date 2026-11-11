# Phase 1 – how to test

## 1. Start

```bash
pnpm install && pnpm dev          # or: docker compose up --build
pnpm test                         # 135 automated tests
```

## 2. Renderer

Open **http://localhost:8080/render/main?debug=1&bg=checker** in a browser (or add
`http://<ip>:8080/render/main` in CasparCG / vMix / OBS, see [renderer-setup.md](renderer-setup.md)).
The overlay should say `connected`.

## 3. Test bench – http://localhost:8080/dev

1. **Set up demo match** – writes `match.home.*`, `match.away.*` and resets `match.clock`.
2. Scorebug → **Take**. The scorebug wipes in with team codes and colours from the data hub.
3. **Start** the clock. It counts in the graphic. Nothing is sent per second (check the log: one request).
4. Press **+** for home. The score pops in the scorebug (binding → partial `updateAction`).
5. **45:00**, then wait: the clock freezes at 45:00 and shows the stoppage as `+0:01`, `+0:02`, …
   Set **Added time** 3 + **Apply** → `+3` shows when not in stoppage.
6. **Goal flash home/away** → custom action `goal`.
7. Lower third → **Take**, edit the JSON (name/title) → **Update** (text cross-fades) → **Out**.
8. Lineup → **Take** (starting XI on a pitch) → **Next ▸** (substitutes and coach) → **Next ▸** (out, end of steps).

## 4. Recovery and robustness

- **Reload the renderer page** while graphics are on air: they come back immediately (no in-animation),
  and the clock shows the right time.
- **Stop the server** (Ctrl+C) → the renderer keeps showing its graphics. Start it again → it reconnects by itself.
- **Faulty graphic**: zip a graphic whose `playAction` throws and upload it in the test bench. Taking it shows
  `⚠ playAction() threw: …` in the layer table, and the other layers keep running. **Clear** removes it completely.
- **Network**: open the renderer on a second machine; both outputs show the same clock.

## 5. OGraf Server API with curl

```bash
# list renderers and graphics
curl http://localhost:8080/ograf/v1/renderers
curl http://localhost:8080/ograf/v1/graphics

# load + play a lower third on layer 20
curl -X POST http://localhost:8080/ograf/v1/renderers/main/target/graphicInstance/load \
  -H 'content-type: application/json' \
  -d '{"renderTarget":{"layer":20},"graphicId":"ogp.lower-third","params":{"data":{"name":"Jane Doe","title":"Referee"}}}'
# → {"graphicInstanceId":"…","statusCode":200}

curl -X POST http://localhost:8080/ograf/v1/renderers/main/target/graphicInstance/playAction \
  -H 'content-type: application/json' \
  -d '{"renderTarget":{"layer":20},"graphicInstanceId":"<id>","params":{}}'

# shortcuts on the internal API
curl -X POST http://localhost:8080/api/v1/channels/main/layers/20/out
curl -X PUT  http://localhost:8080/api/v1/data/match/home/score -H 'content-type: application/json' -d '2'
curl -X POST http://localhost:8080/api/v1/clock/start -H 'content-type: application/json' -d '{"path":"match.clock"}'

# upload a package
pnpm pack:graphics
curl -X POST http://localhost:8080/api/v1/graphics -F file=@dist-graphics/lower-third.zip
```
