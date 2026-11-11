# Writing graphics for this platform

Graphics are plain **OGraf v1** packages, so anything that follows the spec works.
See `graphics/` for three complete examples without dependencies.

## Package layout

```
my-graphic/
  my-graphic.ograf.json   manifest (file name must end with .ograf.json)
  graphic.mjs             ES module, default export = class extends HTMLElement
  assets/…                images, fonts, …
```

Check it with `pnpm validate:graphics graphics/my-graphic`, zip it with `pnpm pack:graphics`, and upload it in
the test bench (or `POST /api/v1/graphics`). Uploading a new version with the same `id` replaces it: the latest upload is used.

## Rules the validator enforces (from the official schema and spec)

- `$schema`, `id` (no `/`), `name`, `main`, `supportsRealTime`, `supportsNonRealTime` are required.
- Extra fields must start with `v_` (we use `v_ogp_…`).
- `actionDurations`: at most one per action type / custom action id, and the ids must exist in `customActions`.
- GDD (the `schema` field): every property needs a `type`; `object` needs `properties`; `array` needs `items`.
  `gddType: "color-rrggbb"` requires `"pattern": "^#[0-9a-f]{6}$"` (lowercase); `gddType: "select"` requires `enum` and `gddOptions.labels`.

## Recommendations

- **Design on a 1920×1080 canvas** and scale it to the element size (see `_fit()` in the examples), so previews and thumbnails work.
- **Never paint before `load()`**, and resolve `load()` only when fonts and images are ready.
- **Merge `updateAction` data** into your state: it can be partial (the server sends only changed keys).
- **Accept overlapping calls.** The examples freeze running animations at their current position
  (`commitStyles()` + `cancel()`) and animate to the new state from there, so "out" during "in" never jumps.
- **Never wait only for `animation.finished`.** Browsers pause animations in hidden tabs and invisible OBS sources,
  so the promise may never resolve and the action times out. Race it against a timer and `finish()` the animation
  (see `_run()` in the examples), and use `fill: 'both'` so delayed parts don't flash before they animate in.
- **Honour `skipAnimation`.** Recovery after a renderer reload uses `playAction({ goto, skipAnimation: true })`.
- **Resolve asset URLs** with `new URL(path, import.meta.url)`.
- **Return `currentStep`** from `playAction` (`undefined` when going to the end).

## Clocks

Bind a clock value (e.g. `{ "$bind": "match.clock" }`) and compute the time locally:

```js
const anchor = clock.anchorLocalMs ?? clock.anchorServerMs;
const elapsed = clock.elapsedAtAnchorMs + (clock.running ? Date.now() - anchor : 0);
```

Update the text in a `requestAnimationFrame` loop, and only when the displayed second changes.
`direction: "down"` counts down from `limitMs`. The example scorebug freezes an up-clock at `limitMs`
(e.g. 45:00) and shows the stoppage time as `+M:SS`.

## Hints for the player (optional, vendor fields)

```json
{
  "v_ogp_defaultLayer": 10,
  "schema": { "type": "object", "properties": {
    "homeScore": { "type": "integer", "default": 0, "v_ogp_bind": "match.home.score" }
  } }
}
```

- `v_ogp_defaultLayer` (manifest): layer for new rundown items (default 20).
- `v_ogp_bind` (schema property): new rundown items bind this field to the data path (the schema default becomes the fallback).

## Data bindings

In the data you send with load/update, any value can be a binding to a data path:

```json
{ "homeScore": { "$bind": "match.home.score", "default": 0 }, "title": "Free text" }
```

The server resolves bindings and sends updates when the data changes. The graphic only sees plain values.
