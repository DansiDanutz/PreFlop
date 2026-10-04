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

## Webcam recognition
The laptop running the console points its camera at the dealt cards. **Read flop** sends one still to the API, which asks Claude which face-up cards it sees and pre-fills the picker. A person still checks the cards and settles; nothing is paid from a reading alone, and typing stays as the fallback.

- **Where:** Console → Manual tables → after *Close betting* → **Use webcam** → **Read flop**. Browsers allow the camera only over https (or localhost), which staging is.
- **What is sent:** one JPEG, at most 1280 px on its long side, from the camera to the API (`POST /v1/admin/manual/read-flop`, admin or ops) and on to Anthropic's API. No video is streamed or stored; the API keeps nothing.
- **Switch:** the API needs the secret `ANTHROPIC_API_KEY` (`fly secrets set ANTHROPIC_API_KEY=… -a preflop-staging-api`). Without it the button answers *card recognition needs ANTHROPIC_API_KEY* (503 `provider_not_configured`). `VISION_MODEL` picks the model (default `claude-opus-5-5`).
- **What comes back:** up to three cards, left to right, a confidence (high, medium, low) and a note on anything it could not read. Only cards whose rank and suit were both clear are returned; the operator picks any missing card by hand.
- **Cost:** one request per hand, roughly a cent at today's prices; see `lib/vision.ts`.

Real-money or physical play from a camera needs the certified capture chain in `docs/12`, not this.
