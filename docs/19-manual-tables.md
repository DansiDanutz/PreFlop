# 19 — Manual tables

A manual table has no Table Box, stream or shuffler. A member of the PreFlop team closes betting and types the three flop cards in the console. Manual tables test camera-free play now. Webcam card recognition comes next (below).

## Rules
- **Play money only.** Two places enforce it: the database (`poker_tables_manual_play_only`, migration 021) and the API. A manual table can never be approved for real money, and real-money tournaments cannot bet on it: a typed flop has no capture or review.
- **Typed after betting closes.** The flop is accepted only once betting has closed, and never on a simulated or physical table.
- **Result deadline.** A flop not entered before `RESULT_SLA_MS` (default 5 minutes) after betting closes is voided, and every bet is refunded. A flop typed after the deadline is refused (409 `round_expired`) and voids the hand the same way.
- **Audited.** The audit log records who closed betting (`round.locked`, `manual: true`) and who typed which cards (`round.manual_flop`). Settled rounds carry `flop_source = 'manual'`.
- **Its own switch.** `manual_tables_enabled` (Console → Settings) is on by default. Switching it off voids and refunds every open hand on a manual table at once, and no new hand opens; a hand already closed for betting can still be typed, or voids at the deadline. It is separate from `physical_play_enabled`, which stays off (`docs/06` #7).
- **Players are told.** The table is labelled *Test table · Flop entered by the PreFlop team*.

## Running a hand (Console → Manual tables, PreFlop admin or ops)
1. Create a table with a name. Betting opens at once.
2. Players bet in the app as on any table.
3. **Close betting** before the flop is dealt. A countdown shows the time left to enter the flop.
4. Pick the three cards on the 52-card grid, then **Settle hand** → **Settle and pay**. Winning bets are paid at once, and the next hand opens.

## API
| Route | Who | What |
|---|---|---|
| `POST /v1/admin/tables/manual` `{name}` | admin, ops | Create a manual table (play money) |
| `GET /v1/admin/tables/manual` | admin, ops | Tables, the current hand, its bets, the last settled flop and the switch |
| `POST /v1/admin/tables/:id/manual/lock` `{hand_no}` | admin, ops | Close betting (OPEN → LOCKED) |
| `POST /v1/admin/tables/:id/manual/flop` `{hand_no, cards}` | admin, ops | Type the flop (LOCKED → SETTLED) and open the next hand; 409 `round_expired` past the deadline |

## Webcam
After *Close betting*, **Use webcam** shows the laptop camera beside the card picker, so the operator can point it at the dealt cards and pick what it shows. The picture stays on the laptop: nothing is uploaded, and no outside service is involved.

**Next: recognition on the laptop.** Card recognition will run inside the console in the browser (OpenCV.js: find the white card rectangles on the felt, read each card's corner rank and suit, pre-fill the picker). No API key, no per-use cost, no photo leaves the machine. The operator still checks the cards and settles; typing stays the fallback. How well it reads depends on the deck, the camera and the light, so the first version is a test page that only reports what it reads, with no bet connected.

Real-money or physical play from a camera needs the certified capture chain in `docs/12`, not this.
