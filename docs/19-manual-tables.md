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
1. Create a table with a name and, optionally, its live stream link (YouTube or Twitch). Betting opens at once.
2. Players bet in the app as on any table.
3. **Close betting** before the flop is dealt. A countdown shows the time left to enter the flop.
4. With the webcam on, the console watches for the flop and shows the frame it read it from: check it against the table and tap **Confirm and settle** → **Settle and pay**. Without the webcam, pick the three cards on the 52-card grid, then **Settle hand** → **Settle and pay**. Winning bets are paid at once, and the next hand opens.

## API
| Route | Who | What |
|---|---|---|
| `POST /v1/admin/tables/manual` `{name, stream_url?}` | admin, ops | Create a manual table (play money), optionally with its live stream |
| `PUT /v1/admin/tables/:id/manual/stream` `{stream_url \| null}` | admin, ops | Set or remove the live stream; 422 `invalid_stream_link` for anything but an https YouTube video or Twitch channel |
| `GET /v1/admin/tables/manual` | admin, ops | Tables, the current hand, its bets, the last settled flop and the switch |
| `POST /v1/admin/tables/:id/manual/lock` `{hand_no}` | admin, ops | Close betting (OPEN → LOCKED) |
| `POST /v1/admin/tables/:id/manual/flop` `{hand_no, cards, snapshot?}` | admin, ops | Enter the flop (LOCKED → SETTLED) and open the next hand; 409 `round_expired` past the deadline. `snapshot` `{image_base64, sha256, read_cards}` is the webcam frame (JPEG, at most 512 KB, hash checked; 422 otherwise, and the hand stays locked) |

## Webcam
After *Close betting*, **Use webcam** shows the laptop camera beside the card picker, so the operator can point it at the dealt cards and pick what it shows. The picture stays on the laptop: nothing is uploaded, and no outside service is involved.

**Recognition on the laptop.** After *Close betting*, **Use webcam** shows the camera beside the picker and **Read cards** reads the frame in the browser: OpenCV.js (a 13 MB library fetched on the first click, once per visit) finds the bright card rectangles on the felt, straightens each, and compares the corner index — the rank glyph over the suit pip — with glyphs the browser draws itself. Both corners of each card are tried, so cards lying sideways or upside down read the same. The result is a proposal: *Use these cards* fills the picker, the operator checks and settles; typing stays the fallback, and a reading with fewer than three sure cards fills nothing. No API key, no per-use cost, no frame leaves the machine. How well it reads depends on the deck, the camera and the light: **Card reader test** (Manual tables → *Card reader test*) reports what the reader sees from the webcam or a photo, with the cards it found outlined and scored, and no bet connected. On the hosting side the console's headers allow the camera (`Permissions-Policy: camera=(self)`) and WebAssembly (`script-src 'wasm-unsafe-eval'`); the other apps keep both off.

**Suits.** Pips share one solid body and a stem, so pixel correlation alone barely separates ♠ from ♣ or ♥ from ♦; the reader also scores the crown's silhouette (ink width per row in the top 40 %: a spade or diamond grows from a point, a club starts wide, a heart widest), and keeps every glyph template at three focus levels (crisp, soft, softer) so an out-of-focus card is compared with templates softened the same way; the best level counts.

**Tests.** `vision.test.ts` covers the pure helpers; `reader.frame.test.ts` runs the real OpenCV.js build in a headless Chromium (Playwright) on synthetic frames drawn by `apps/console/test-harness/reader.html`: three upright cards, tilted and upside-down cards, landscape cards, two cards (no flop), an empty felt, and the same cards under what a table does to a frame (uneven light, a skewed camera, soft focus, sensor noise, a red felt, black suits tilted and blurred). `apps/api/test/e2e-manual-table.test.ts` drives the operator's whole flow: the real console (Vite dev server) against the real API in a Chromium whose camera is a canvas showing three cards; sign in, close betting, use webcam, the watcher captures the flop, confirm and settle; the round settles on those cards, the frame is stored with a matching SHA-256, the bet is paid and the next hand opens. CI installs the browser for both. Real decks, cameras and light still differ from the synthetic scenes; that is what the Card reader test page is for.

**Second opinion.** When `JEV_API_KEY` is set (docs/20), each reading is also put to the decision model: per card, is a match of this confidence and runner-up margin sure enough to pre-fill? The webcam panel and the test page show *Adviser:* badges (✓ or ? with the model's probability that pre-filling is safe, e.g. "✓ 93 % safe", "? 55 % safe"; ✓ from 70 % up) and name the cards to check by eye. It never changes the proposal or the picker; without the key it is silent.

## Live stream and flop snapshots (migration 032)
**For players.** A manual table can carry a live stream: the webcam over the felt, broadcast by the operator's streaming app (OBS or similar) to YouTube Live or Twitch. The console takes the link; only the video id or channel name is stored (`poker_tables.stream_provider`, `stream_id`, checked by the database), never the URL. `GET /v1/tables/:id` and the lobby return `stream: {provider, id}`, and the table page shows the player, muted so it starts by itself, in place of the drawn felt. The page builds the embed address itself (`streamEmbedUrl` in `@preflop/client`: `youtube-nocookie.com/embed/<id>` or `player.twitch.tv/?channel=<id>&parent=<host>`), the iframe is sandboxed, and the web CSP frames those two players only (`frame-src https://www.youtube-nocookie.com https://player.twitch.tv`); the tablet app still frames nothing. In the partner widget a Twitch stream falls back to the felt, because Twitch refuses to play inside sites it was not told about. A stream has a few seconds of delay, so betting is closed in the console as before, never from the video.

**Watching for the flop.** After *Close betting* the console reads the webcam once a second (the same in-browser reader). A dealer's hand over the cards gives partial reads, so a flop counts only when the same three cards are read three times in a row (`flopWatch.ts`). The previous hand's flop, if still on the felt, never counts. Only the table whose hand you are running opens the camera by itself; the remembered camera is per table. The console then keeps that frame (a JPEG up to 960 px wide), fills the picker and shows the frame beside **Confirm and settle**. Nothing settles without that tap, and the operator can correct a card first. The camera can be the webcam itself or the streaming app's virtual camera (chosen in the panel), and the choice is remembered for the next hand in this tab. *Stop watching* turns back to one-off **Read cards**.

**Evidence.** The frame is sent with the settlement with its SHA-256; the API checks it is a JPEG whose hash matches, stores it in `manual_flop_snapshots` (one per round, append-only, with the cards settled on, the cards the camera read — they differ when the operator corrected one — and who confirmed them), and puts the hash in the `round.manual_flop` audit entry. A hand settled by typing alone has no snapshot.

Real-money or physical play from a camera needs the certified capture chain in `docs/12`, not this.
