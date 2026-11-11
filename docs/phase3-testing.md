# Phase 3 – how to test

```bash
git pull && pnpm install && pnpm dev
```

Open three windows (the renderer in its own window, not a background tab):
**data tool** http://localhost:8080/data/, **player** http://localhost:8080/player/,
**renderer** http://localhost:8080/render/main?debug=1&bg=checker.

1. **Setup** – data tool: *+ Create a match*. Name both teams, codes (NBR / EPU), colours, upload a logo,
   *Paste list…* a squad for each team (`1 Eriksson, GK` …). Check XI 11/11. Set coach and formation.
2. **Make active**.
3. **Player** – new rundown, add *Scorebug*, *Event banner*, *Lineup*. They are pre-bound to `match.*`
   (🔗 in the editor). Take the scorebug: team codes, colours and 00:00.
4. **Kick-off** in the data tool – the clock starts on the scorebug (counted locally, no ticks).
5. **GOAL NBR** → tap the scorer → the scorebug score pops; take the *Event banner* in the player →
   "GOAL 1–0 · 9 ADEYEMI". Tap *Undo* in the confirmation → the score goes back.
6. **Yellow** (twice on the same player → red), **Substitution** (off, then on), **VAR** – with the event banner on air
   it follows each event.
7. **Edit** a goal in the event log: penalty, other scorer, minute `12'`.
8. **Clock**: stop/start, ±1′, *Set…*; **Added time** + → `+3` on the scorebug; go past 45:00 → `45:00 +0:12`.
9. **End 1st half** → scorebug `HT`, clock 45:00; **Start 2nd half** → counts from 45:00.
10. **Lineup** in the player: starting XI on the pitch from the squad (step 2: bench and coach).
11. **End 2nd half → Start penalties** → who kicks first → SCORED/MISSED. It stops when decided; the scorebug shows
    `PENS 4–2`. **End penalties**.
12. **Ctrl/⌘+Z / Shift+Ctrl/⌘+Z** undo/redo; reload any window – everything comes back.
