# Phase 2 – how to test

```bash
git pull && pnpm install && pnpm dev      # or: docker compose up --build
```

Open the **player** at http://localhost:8080/player/ and an output renderer at
http://localhost:8080/render/main?debug=1&bg=checker (or in CasparCG / vMix / OBS).

1. **Match data** – until the data tool arrives (Phase 3), open http://localhost:8080/dev → *Set up demo match*
   and *Start* the clock. Leave it open in a tab to change scores.
2. **Rundown** – *Rundowns → + New*. Add *Scorebug*, *Lower third* (twice) and *Lineup* from the library.
   New items land after the selected item.
3. **Edit** – select a lower third, type a name and title. The PVW preview follows as you type; the item label
   changes. Open *More fields* for accent colour and position.
4. **Bindings** – select the scorebug: its fields are bound to `match.*` (🔗, current value shown). Change a score
   in /dev → the scorebug and the item label update. Unbind a field (🔗) to type a fixed value.
5. **Take** – select the scorebug, press **Space**. Selection moves on (Auto-advance). Space again takes the lower
   third. Both rows turn red with a time-on-air counter; *On Main* lists them.
6. **Live edit** – select the on-air lower third, change the title: *Edited data is not on air yet* appears and
   UPDATE lights up. Press **U**. (Or switch on *Live update*.)
7. **Out-then-in** – take the second lower third: the first one animates out, then the new one animates in.
8. **Steps** – take the lineup, **→** for the bench, **←** back, **→ →** to finish. PVW has step buttons 1/2.
9. **Out** – **O** takes out the selected (or last taken) item; **Shift+O** takes everything out.
10. **Auto-out** – set *Auto-out (s)* to 5 on a lower third and take it.
11. **Reorder / duplicate / delete** – drag rows, Alt+↑/↓, Ctrl/⌘+D, Delete.
12. **Several operators** – open the player in a second window: selection, edits and status follow live.
13. **Robustness** – reload the player or the renderer at any time; everything comes back.

Press **?** for all shortcuts. Automated tests: `pnpm test`.
