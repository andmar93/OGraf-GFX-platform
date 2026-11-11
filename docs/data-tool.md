# Match data tool

**http://&lt;server&gt;:8080/data/** – built for a tablet or a touch screen next to the pitch.

## Workflow

1. **+ New match** → *Setup*: team names, codes (3–4 letters for the scorebug), colours, logo (upload), coach,
   formation and the squad. *Paste list…* takes one player per line (`7 Name`, `7. Name, MF`, …); the first 11
   become the starting XI. Set XI / Bench / – per player, the captain (C), and order the XI goalkeeper first, then
   defence → attack, left to right (that is how the lineup graphic places them on the pitch).
   Half length, extra time and shootout rounds are under the match name. Everything saves automatically.
2. **Make active** – the active match feeds the graphics (`match.*` data paths). Only one match is active.
3. **Live** – the big blue button is always the next step of the match: *Kick-off → End 1st half → Start 2nd half →
   End 2nd half → End match / Start extra time / Start penalties*.

## During the match

| | |
|---|---|
| **GOAL** | Opens the scorer picker (players on the pitch first). Choose *Goal*, *Penalty* or *Own goal* (then the opponent's players are listed). "Goal without scorer" works too. |
| **Yellow / Red** | Pick the player. A second yellow becomes a red automatically. |
| **Substitution** | Tap the player going off, then the player coming on. |
| **Corner, Shot, On target, Foul, Offside** | One tap, counted in the stats. |
| **VAR** | Reason × decision (checking / stands / overturned). |
| **Clock** | Runs from the period start. *Stop/Start clock* for interruptions, ±1′ / ±1″ and *Set…* (mm:ss) to correct it. |
| **Added time** | − / + sets the announced stoppage time (shown as +N on the scorebug). |
| **Penalties** | Choose who kicks first, then *SCORED / MISSED* per kick. The order (ABAB), sudden death and the early decision are handled automatically. |

Every action can be undone: **↶ Undo** (or Ctrl/⌘+Z, redo with Shift), or the *Undo* button in the confirmation that
pops up. **Edit** in the event log changes the team, player, goal type, card or minute of any event, or deletes it.
The match state is always recalculated from the event list, so corrections are exact.

## How the clock works

The server never sends clock ticks. Starting/stopping/adjusting creates an event; the published `match.clock` is an
anchor (start time + elapsed + running) and every screen and graphic counts locally. In the 1st half the scorebug
counts to 45:00, then shows the stoppage time as +M:SS; the 2nd half starts at 45:00, extra time at 90:00.

## Data paths

See [data-paths.md](data-paths.md) for everything graphics can bind to.
