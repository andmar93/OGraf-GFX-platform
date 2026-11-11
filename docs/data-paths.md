# Data paths published by the active match

The active match (data tool → *Make active*) is published under `match`. Bind graphic fields to these paths in the
player (🔗). Example graphics come pre-bound (`v_ogp_bind`).

| Path | Example | |
|---|---|---|
| `match.name` | `Northbridge FC – Eastport United` | |
| `match.phase` | `pre` `H1` `HT` `H2` `FT` `ET1` `ETHT` `ET2` `AET` `PEN` `END` | |
| `match.periodName` | `1st half` | long name |
| `match.period` | `''` `HT` `FT` `ET` `AET` `PENS 4–3` | short tag for the scorebug (empty while a half is played) |
| `match.clock` | clock value | `{ $type: "clock", running, anchorServerMs, elapsedAtAnchorMs, limitMs, label }` |
| `match.running` | `true` | clock running |
| `match.addedTime` | `3` | announced stoppage minutes (0 outside a running period) |
| `match.home.*` / `match.away.*` | | per team: |
| `….name` `….code` `….color` `….color2` `….logo` `….coach` `….formation` | | team setup |
| `….score` | `2` | |
| `….pens` | `4` or `null` | shootout score |
| `….starters` | `[{ id, number, name, position, captain }]` | starting XI (setup order) |
| `….substitutes` | same | bench |
| `….onPitch` | same | current players on the pitch (after subs and red cards) |
| `….stats` | `{ shots, shotsOnTarget, corners, fouls, offsides, yellowCards, redCards }` | |
| `….scorers` | `["Adeyemi 12' (pen.), 67'"]` | |
| `match.events.last` | event | last goal / card / sub / VAR |
| `match.events.lastGoal` `lastCard` `lastSub` | event | last of that kind |
| `match.events.list` | `[event, …]` | newest first (40) |
| `match.shootout` | `{ active, first, home: [true,false…], away, homeScore, awayScore, decided, winner, nextTeam }` | |
| `match.result` | `{ finished, winner: "home" \| "away" \| "draw" \| null }` | |

An **event** is `{ kind, team, teamName, teamCode, teamColor, teamLogo, minute, text, playerName, playerNumber,
inName, inNumber, outName, outNumber, score }`. `kind` is one of `goal`, `penalty_goal`, `own_goal`, `yellow`,
`second_yellow`, `red`, `sub`, `var`, `corner`, `shot`, `shot_on_target`, `foul`, `offside`, `added_time`,
`period_start`, `period_end`, `match_end`, `shootout_scored`, `shootout_missed`. `minute` is like `23'` or `45+2'`.
For an own goal, `team` is the team the goal counts for and the player is from the other team.

Note: while a match is active it owns `match.*` – values written to `match` from the /dev test bench are overwritten
on the next event.
