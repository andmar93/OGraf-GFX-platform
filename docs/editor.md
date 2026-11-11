# Graphics editor

**http://&lt;server&gt;:8080/editor/** – build OGraf graphics without code and publish them to the library.

## Concepts

- A **project** is the editable source: layers on a 1920×1080 artboard plus **data fields**. Projects are saved on
  the server automatically.
- **Publish to library** exports the project as a standard OGraf package and imports it into the graphics library:
  it appears in the player right away. Publishing again replaces it (same graphic id, version + 1).
- **Download .zip** gives the same package as a file – it runs in any OGraf renderer (manifest + one self-contained
  `.mjs` Web Component with no dependencies + bundled images).
- **Import** opens a package exported by the editor (or a project `.json`) as a new project.

The canvas runs the **same runtime as the exported graphic** (inside the renderer's isolated layer frame), so what you
see is exactly what goes on air.

## Layers

| Type | |
|---|---|
| **Text** | Content with data fields in braces: `{title}`, `{homeCode} {homeScore}`. Font, size, weight, spacing, line height, alignment, colour, uppercase/italic, shadow. *Shrink to fit* keeps one line and shrinks the font when the text is wider than the box. |
| **Shape** | Rectangle (corner radius) or ellipse; fill or two-colour gradient; stroke; shadow. |
| **Image** | Upload (stored on the server, bundled into the package on export) or a URL; contain / cover / stretch. |
| **Group** | Container; children are positioned relative to it. Select a group and add layers to put them inside. Optional clipping. |

Select on the canvas or in the list; drag to move, handles to resize (Shift keeps the ratio), arrows nudge (Shift ×10).
Moving snaps to the centre, edges, the safe areas (EBU R95: action safe 93 %, graphics safe 90 %) and other layers –
hold Alt to move freely. Eye = visible, lock = not selectable on the canvas. ▲▼ change the stacking order,
Ctrl/⌘+D duplicates, Delete removes, Ctrl/⌘+Z / Shift+Ctrl/⌘+Z undo/redo, Ctrl/⌘+S saves.

## Data fields

Fields become the graphic's OGraf schema – the form operators fill in the player. Types: text, multi-line, number,
whole number, on/off, colour, image URL and **clock**. The default value is also the test value on the canvas.

**Bind to data path** sets the default binding for new rundown items (e.g. `match.home.score`, `match.home.color`,
`match.clock`) – the player then updates the graphic live from the data tool. Paths of the current data are suggested.
Switch on **Live data** above the canvas to see the real values.

Use fields in text as `{key}`. Clock fields: `{clock}` → `23:41` (frozen at the period limit), `{clock:stoppage}` →
`+1:23`, `{clock:minute}` → `24'` / `45+2'`. Formats for other fields: `{key:upper}`, `{key:lower}`, `{key:pad2}`.

Properties can be bound too: shape fill and text colour (colour field), image source (image or text field), and
*visible when* (on/off field, or any non-empty value).

Renaming a field key updates every text and binding that uses it. Fields that layers use but that do not exist are
offered for creation.

## Animation (MVP)

Each layer has an **in** and an **out** preset – fade, scale, pop, slide (4 directions, distance) or wipe (4 directions) –
with delay, duration and easing. Delays are relative to the take / out, so staggering layers is just a matter of
delays. ▶ In and ■ Out above the canvas preview them. The full timeline with keyframes and steps comes in Phase 5.
