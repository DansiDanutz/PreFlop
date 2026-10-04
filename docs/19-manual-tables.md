# 19 — Manual tables

A manual table has no Table Box, stream or shuffler. A member of the PreFlop team closes betting and types the three flop cards in the console. Manual tables test camera-free play now. Webcam card recognition comes next (below).

## Rules
- **Free play only.** Play money or free chips. Two places enforce it: the database (`poker_tables_manual_free_play`) and the API.
- **Typed after betting closes.** The flop is accepted only once betting has closed, and never on a simulated or physical table.
- **Result deadline.** A flop not entered before `RESULT_SLA_MS` (default 5 minutes) after betting closes is voided, and every bet is refunded.
- **Audited.** The audit log records who closed betting (`round.locked`, `manual: true`) and who typed which cards (`round.manual_flop`). Settled rounds carry `flop_source = 'manual'`.
- **Its own switch.** `manual_tables_enabled` (Console → Settings) is on by default. Off: no round opens, and betting can't be closed. It is separate from `physical_play_enabled`, which stays off (`docs/06` #7).
- **Players are told.** The table is labelled *Test table · Flop entered by the PreFlop team*.

## Running a hand (Console → Manual tables, PreFlop admin or ops)
1. Create a table: a name, then *Play money* or *Free chips*. Betting opens at once.
2. Players bet in the app as on any table.
3. **Close betting** before the flop is dealt. A countdown shows the time left to enter the flop.
4. Pick the three cards on the 52-card grid, then **Settle hand** → **Settle and pay**. Winning bets are paid at once, and the next hand opens.

## API
| Route | Who | What |
|---|---|---|
| `POST /v1/admin/tables/manual` `{name, mode?}` | admin, ops | Create a manual table (`mode`: `play` or `virtual-chips`) |
| `GET /v1/admin/tables/manual` | admin, ops | Tables, the current hand, its bets, the last settled flop and the switch |
| `POST /v1/admin/tables/:id/manual/lock` `{hand_no}` | admin, ops | Close betting (OPEN → LOCKED) |
| `POST /v1/admin/tables/:id/manual/flop` `{hand_no, cards}` | admin, ops | Type the flop (LOCKED → SETTLED) and open the next hand |

## Next: webcam recognition
The webcam fills the same three-card picker; a person still confirms before anything is paid.
1. The Manual tables screen opens the laptop webcam in the browser (`getUserMedia`).
2. **Read flop** takes a still and finds the three cards.
3. The picker is pre-filled, and the operator checks it and settles as above.

The typed path stays as the fallback. Real-money or physical play from a camera needs the certified capture chain in `docs/12`, not this.
