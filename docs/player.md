# Player (operator UI)

**http://&lt;server&gt;:8080/player/** (the server root redirects here).

```
┌ Rundowns ────┐┌ PGM (program channel) ┐┌ PVW (selected item) ┐┌ On <channel> ───────────┐
│ list, + New  ││ live renderer preview  ││ local preview, step  ││ loaded layers, Next/Out │
├ Graphics ────┤├───────────────────────────────────────────────┤├ Item editor ────────────┤
│ library      ││ Rundown items (drag to reorder)               ││ name, channel, layer,   │
│ + Add, Upload││ status · label · step · layer · time on air   ││ auto-out, data form     │
└──────────────┘└───────────────────────────────────────────────┘└─────────────────────────┘
 Selected item · CUE · TAKE · ◂ PREV · NEXT ▸ · OUT · UPDATE ·················· OUT ALL
```

## Concepts

- **Rundown**: an ordered list of items. Several rundowns can exist; they are shared by all operators
  (changes appear live everywhere).
- **Item**: graphic + data + target channel/layer (+ optional auto-out time). New items get the graphic's
  default layer (`v_ogp_defaultLayer`) and default data, with fields pre-bound to match data where the graphic
  suggests it (`v_ogp_bind`).
- **Selected item** (blue outline): what Take/Cue act on. It is stored on the server as the rundown's
  *cursor*, so automation (Companion, Phase 6) can "take next" the same item.
- **Status**: `CUED` (loaded, not visible), `ON AIR` (with time on air and step), `OUT` (played out, still loaded),
  `layer busy` (another graphic is on the item's layer).

## Playing out

| Button / key | |
|---|---|
| **TAKE** – Space / F2 | Plays the selected item. If another graphic is on air on that layer, it animates out first. If the item is already on air and has several steps, Take goes to the next step. With *Auto-advance* on, the selection then moves to the next item. Double-clicking an item also takes it. |
| **CUE** – C / F3 | Loads the selected item without showing it (fast take later). |
| **NEXT / PREV** – → / ← | Step forward/back. Acts on the selected item if it is loaded, otherwise on the last taken item (red dot). |
| **OUT** – O / F1 / Esc | Animates out (same target rule as Next). |
| **UPDATE** – U / F6 | Sends edited data to the on-air item. Highlighted when the editor holds changes that are not on air yet. |
| **OUT ALL** – Shift+O | Every playing layer on the program channel goes out. |
| Shift+Esc | Clear the program channel immediately (panic, after confirmation). |

Shortcuts are ignored while typing in a field (Esc leaves the field). Press **?** for the list.
Editing: ↑/↓ select, Alt+↑/↓ move, Ctrl/⌘+D duplicate, Delete delete.

## Editing data

The form is generated from the graphic's GDD schema: text, multi-line, colour picker, select, numbers
(with −/+), checkboxes, image paths, nested objects and tables for arrays (e.g. lineup players).
Fields marked `hidden` in the schema are under **More fields**.

**🔗 Binding**: any field can be bound to a data path (autocomplete lists the current data hub paths, and
the current value is shown). The server resolves bindings and updates on-air graphics when the data changes.
Unbinding keeps the last fallback value.

Edits are saved automatically. While an item is on air, edits go on air when you press **Update** – or
immediately with **Live update** switched on.

## Previews

- **PGM** is a real renderer (`/render/<channel>?preview=1`) showing what is on the channel. It does not count as an output.
- **PVW** renders the selected item locally (same isolation as the renderer) with live data, at the chosen step.

## Development

`pnpm dev` rebuilds the player on change (reload the page). For hot module reload while working on the UI:
`pnpm --filter @ogp/player dev:hmr` → http://localhost:5173/player/ (API and WebSocket are proxied to :8080).
