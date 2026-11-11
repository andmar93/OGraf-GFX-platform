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

**Copy / cut / paste** – Ctrl/⌘+C, X, V (or the *Copy*, *Cut*, *Paste* buttons under the layer list). Layers go to the
system clipboard, so you can paste them into another graphic or another browser tab; data fields the layers use are
added to the target graphic if it does not have them. Pasting into the same graphic offsets the copy by 20 px; with a
group selected the paste goes into the group, otherwise above the selected layer. Pasting an **image** (e.g. a
screenshot or a logo copied in the browser) uploads it as an image layer; pasting plain **text** creates a text layer.
While you type in a field, copy/paste work on the text as usual.

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

## Timeline and keyframes

The panel under the canvas is the graphic's timeline (ms). The canvas always shows the graphic **at the playhead**.

**Animatable properties** – X, Y, Scale, Rotation, Opacity and Mask left/right/top/bottom (crop in % from each edge;
animating a mask gives wipes and reveals). Width/height, colours and text are static.

- **⏱ stopwatch** (in the properties panel or on a property row in the timeline) starts animating a property: it adds
  a keyframe at the playhead with the current value. From then on, changing the value – typing, dragging the layer,
  arrows, align – sets a keyframe **at the playhead**. Clicking ⏱ again stops animating and keeps the value at the
  playhead as the static value.
- **◆** adds or removes a keyframe at the playhead; ◂ ▸ jump to the previous / next keyframe.
- **Keyframes in the timeline** – click to select (Shift/Ctrl adds), drag to move (snaps to the playhead, markers and
  other keyframes; Alt = no snap), **Del** deletes. The collapsed layer row shows all its keyframes (◆ grey) – dragging
  one moves every keyframe of the layer at that time. The inspector at the top edits time, value and **easing**
  (smooth, ease in/out, overshoot, linear, hold = jump) of the selected keyframes; the easing applies from the keyframe
  to the next one.
- **Playhead** – click/drag the ruler to scrub; ▶ or **Space** plays the timeline in the canvas.
- **Quick animation** (properties panel) generates in/out keyframes from a preset (fade, scale, pop, slide, wipe) at
  the playhead – a fast start that you then fine-tune by hand.

### Steps, In and Out

The markers on the ruler define how the timeline maps onto OGraf actions:

| Marker | Meaning |
|---|---|
| **S1** | End of the **In** animation: *take* plays 0 → S1 and holds. |
| **S2, S3 …** | Extra steps (**+ Step** at the playhead). Each **Next** in the player plays to the next marker and holds. Double-click a marker to remove it. |
| **OUT** | *Out* plays OUT → end of the timeline, then the graphic is hidden. |
| **▏** (end) | Length of the timeline (drag it, or type the duration). |

The exported manifest gets `stepCount` = number of step markers and per-action durations, so the player shows the
right number of steps. Going back a step (`goto` an earlier step) eases to that state in 400 ms. Buttons **▶ In**,
**⏭ Next** and **■ Out** above the canvas preview the real actions; *Back to edit* returns to the playhead view.

Projects made before Phase 5 (in/out presets with delays) are converted to keyframes automatically when opened.

## Multi-select, align and group

- **Select several layers**: Shift/Ctrl/⌘-click on the canvas; on the layer list Shift-click selects a range and
  Ctrl/⌘-click toggles; drag on empty canvas for a **marquee** (Shift/Ctrl to add); **Ctrl/⌘+A** selects all.
- Drag any selected layer to move them all (snapping uses the bounds of the selection); arrows nudge, **Ctrl/⌘+C / X /
  V / D** and **Del** work on the whole selection.
- With several layers selected, the properties panel offers **align** (left / centre / right / top / middle / bottom)
  and **distribute** (3+ layers, equal gaps). With one layer, *Centre H/V* centres it on the canvas. Align works at the
  playhead, so animated positions get a keyframe.
- **Ctrl/⌘+G** groups the selected layers (they must be in the same group/level), **Ctrl/⌘+Shift+G** ungroups. Grouping
  keeps everything where it is: child positions and their keyframes become relative to the group. A group can be
  animated as a whole (e.g. slide the group, fade the children).

## Shortcuts

| Key | |
|---|---|
| Space | Play / pause the timeline |
| Del / Backspace | Delete the selected keyframes, otherwise the selected layers |
| Arrows (Shift = ×10) | Nudge (sets keyframes when animated) |
| Ctrl/⌘ + Z / Shift+Z / Y | Undo / redo |
| Ctrl/⌘ + C / X / V / D | Copy / cut / paste / duplicate |
| Ctrl/⌘ + G / Shift+G | Group / ungroup |
| Ctrl/⌘ + A | Select all |
| Esc | Clear the selection |
| Ctrl/⌘ + S | Save now |
