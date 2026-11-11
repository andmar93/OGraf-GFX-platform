# Phase 5 – how to test

```bash
git pull && pnpm install && pnpm dev
```

Open the **editor** http://localhost:8080/editor/, the **player** and a renderer window
(http://localhost:8080/render/main?debug=1&bg=checker).

1. **+ New graphic** → "Timeline test". The starter lower third is already keyframed: the background wipes in, the
   accent reveals, title and subtitle slide and fade in; everything fades out. The timeline under the canvas shows S1
   (end of In, 800 ms) and OUT.
2. **Scrub** – drag on the ruler; the canvas follows. Press **Space** to play the whole timeline.
3. Select **Title**: its property rows open in the timeline. Move the playhead to ~400 ms, click **⏱** next to *Rotate*
   in the properties panel and type 15 → a keyframe. Move the playhead to 800 ms and type 0 → second keyframe. Scrub:
   the title rotates. Select a keyframe, change its easing to *Overshoot* in the inspector; drag it (snaps to the
   playhead and markers), Del deletes it.
4. Drag the title on the canvas at another playhead time → an X/Y keyframe is set there (its X track is animated).
5. **Quick animation** – select *Subtitle*, Segment *Out*, Preset *Slide ↓*, Add keyframes → keyframes after OUT.
6. **Steps** – put the playhead at ~1400 ms and press **+ Step** (S2). Animate something between S1 and S2 (e.g. the
   accent's Scale: ⏱ at S1, then at S2 set 120 %). Drag OUT after S2 and extend the end marker if needed.
7. Preview with **▶ In**, **⏭ Next**, **■ Out** above the canvas; *Back to edit* returns to scrubbing.
8. **Multi-select** – Ctrl/⌘-click Title and Subtitle (or drag a marquee on empty canvas): the properties panel shows
   *2 layers selected* → **⇤ Left** aligns them. Drag them together; arrows nudge both. **Ctrl/⌘+G** groups them (the
   group can then get its own animation), **Ctrl/⌘+Shift+G** ungroups. Ctrl/⌘+D duplicates both, Del deletes both,
   Ctrl/⌘+Z undoes.
9. **Publish to library** → in the player add it to a rundown: it shows **2 steps**. Take → In plays to S1; **Next** →
   the S1→S2 animation; Out → OUT to end. Check the renderer window.
10. Open an older (Phase 4) project: its presets were converted to keyframes and it plays as before.
