# Phase 4 – how to test

```bash
git pull && pnpm install && pnpm dev
```

Open the **editor** http://localhost:8080/editor/, the **player** and a renderer window.

1. **+ New graphic** → "Score strip". You get a starter lower third (background, accent, title, subtitle) with two
   fields, `title` and `subtitle`.
2. **Canvas** – click layers, drag them (watch the pink snap guides on centre / safe areas / other layers; Alt = no
   snap), resize with handles (Shift keeps the ratio), arrows nudge. Toggle *Safe areas*. Undo/redo with Ctrl/⌘+Z.
3. **Properties** – change font size, colours, gradient, radius, rotation, opacity. Upload an image layer.
4. **Data fields** tab – add a field `homeScore`, type *Whole number*, bind to `match.home.score` (suggested if a match
   is active). Add a text layer with content `NBR {homeScore}`. Switch on **Live data**: the canvas shows the live score.
5. Add a colour field `teamColor` bound to `match.home.color`; select the background and set *Fill from* = teamColor.
6. **Animation** – set in/out presets and delays per layer; **▶ In** / **■ Out** preview them.
7. **Publish to library** → in the player the graphic appears in the library; add it to a rundown – the bound fields
   are pre-filled (🔗). Take it: score and colour follow the data tool live.
8. Edit again in the editor and publish → the player uses the new version on the next take.
9. **Download .zip**, then in the editor's start screen **Import…** the zip → an identical copy of the project (images
   included). The zip also validates with `pnpm validate:graphics <file.zip>`.
