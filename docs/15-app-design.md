# 15 — App design

The player app follows the approved **charcoal, emerald and ivory** design. It started from Codex's three concept sheets ("Mobile concept 01", "Clubs & tables", "Your favorite bets") and was then aligned with Codex's practice app (`codex/play-money-app`, `web/`). The practice app's layout is the reference for every screen below. The PreFlop app keeps its own backend: live simulated tables over WebSocket, the server ledger, rooms, and the signed table protocol.

The tokens live in `packages/ui/src/tokens.css` and the shared components in `packages/ui/src/index.tsx`. The console and the club tablet use the same tokens. Screenshots are in [`docs/screens/web`](screens/web).

## Visual language

- **Surfaces:** charcoal-green background (`bg` #0e1311). Cards are `surface` with a hairline `line-strong` border and a 12 px radius. Tiles and inputs use 8–10 px.
- **Accent:** mint (`accent` #53e6a7) for primary buttons, the selected favorite, "Ready to play" dots, the active nav item and eyebrows. Text on accent is `accent-ink`. `accent-deep` (#173b2a) fills the PRACTICE pill, the active nav item and the selected stake.
- **Type:**
  - Georgia serif for the wordmark (**PreFlop ♠**, with a small mint spade) and the large headings ("Find your table.", "Your activity.", "What will the next three cards bring?").
  - Inter for everything else.
  - Each page header has three lines: an uppercase mint **eyebrow** ("YOUR NEXT THREE CARDS"), the serif title, and a one-line subtitle.
- **Felt:** a radial felt with a fine noise and an oval rail (`.felt`, `.felt-noise`, `.felt-ring`).
  - Each club has its own colour: green, blue or violet (`feltTheme`). An offline table is grey and dimmed.
  - The felt carries a **SIMULATED TABLE** tag, an italic "PreFlop" watermark and a small "TABLE 04" emboss.
  - Physical-table play is disabled (`docs/06` #7), so every table says it is simulated. There is never a fake video.
- **Cards:** ivory faces (#f5f3e9) with Georgia indices, red #b23237, and a 6 px radius.

## Layout

- **Wide screens** (≥ 1024 px):
  - A **left rail**: the wordmark, "THE FLOP IS JUST THE BEGINNING", then Lobby · Clubs · Activity · Profile. At the foot: "All instinct. Zero real money.", **How to play**, and "Free chips · No cash value".
  - A **top bar**: the section name ("LOBBY", "THE TABLE"…) and the **PRACTICE** pill at left; the chip balance ("10,000 free chips") and the avatar at right.
- **Phones:**
  - The top bar shows the wordmark and the balance.
  - A **bottom tab bar** has the same four items.
  - Dialogs become bottom sheets.
- **Footer** on every app page: "Simulated tables while physical-table play is switched off." and "Free chips. No purchases, prizes or cash-out."
- **How to play** (a sheet): 1 Choose, 2 Lock, 3 Reveal. It explains that decimal odds include the stake, and that there is no auto-replay or countdown pressure.

## Screens

### Lobby — "Find your table."
- Header: the eyebrow "YOUR NEXT THREE CARDS" and a **How to play** button.
- A search field ("Search tables or clubs") and the text tabs **All tables · Available · ☆ Saved**. Saved tables are kept on the device.
- An **All clubs** select.
- "N tables" with "Choose your atmosphere. Play at your pace."
- A grid of **table cards** (1, 2 or 3 columns):
  - a felt with the table's last real flop, a save star, and the code;
  - "Ready to play" or "Offline";
  - the serif name and the club link;
  - "City / Practice", then **Take a seat ›**, or "Check back later" when offline.
- The banner "A little intuition. A lot of possibilities." with **Explore the bets ›**.
- **Organizer rooms** (chips or diamonds, no cash value).

### Clubs and club page
- **Clubs** ("The clubs."): one card per club, with a monogram, the city, the table count and how many tables are open now, a favorite star, and **Visit club ›**.
- **Club page:**
  - "‹ All clubs";
  - a large ringed monogram, the eyebrow "ORGANIZER", the serif club name and "City · Country";
  - a table-count chip and a star;
  - then **Choose a table** ("Simulated play · No live club connection") with the same table cards as the lobby.

### Table
- Header: "‹ Club", the serif table name, the club and city, the PRACTICE pill, and an ⓘ button that opens How to play.
- **Left column, the table card:**
  - a large felt with the **previous flop**, an expand button, and "Previous flop · Round N · High card" / "Simulated · Not a live stream";
  - the numbered steps **1 Choose · 2 Lock · 3 Reveal**, which follow the live round state;
  - the prompt: the eyebrow "A FRESH FLOP AWAITS" and **"What will the next three cards bring?"**, with a line saying the round is open and that the cards shown are the previous flop;
  - "Your predictions in play" while bets are open.
- **Recent flops at this table:** the last five flops, with their result and round number.
- **Right column, the bet panel:**
  - **Favorite bets** with a count badge and **Edit**.
  - Six tiles in 2 columns. Each tile has an icon, the name, the family and the odds ("5.50×"). The selected tile has the accent border and a check; the others show a small star.
  - **Browse all N bets ›**.
  - **Your prediction** (with a Rules link) and the odds in accent.
  - **Amount:** the min–max range, a − / input / + stepper, and the presets **50 · 100 · 250 · 500**.
  - **Total return if correct** ("550 chips"), with "Decimal odds include your original chips."
  - **Confirm · 100 chips**, then "Free chips. No purchases, prizes or cash-out."
  - In a room the panel shows the room's currency and fees, or the pool rake.
- **Order:** on phones the bet panel comes right after the table card. On wide containers it sits beside the table and recent flops. This uses container queries, so the partner iframe (`/embed/table/:id`) uses the same component.

### Catalogue — "Find your next favorite."
- A dialog over the table. `/app/table/:id/bets` opens it directly.
- Header: the eyebrow "YOUR TABLE, YOUR WAY" and the subtitle "Explore the complete catalogue."
- A search field ("Search bets, cards or rules").
- Chips for the engine's seven families: **All bets · Rank patterns · Suits & colors · High & low · Faces & ranks · Sequences · Totals & parity · Combinations**.
- A count line ("250 selections · 247 offered" with "Decimal odds · Stake included"), then rows grouped by family. Each row shows the icon, the name, the market and probability, the odds, and a star.
- Tapping a row makes it the prediction. The star adds or removes it as a favorite.
- When all six slots are full, **Replace a favorite.** shows the new bet, a radio grid of the six, a strike-through preview and **Replace favorite**.

### Round complete
- The eyebrow "THE FLOP IS OUT" and **Round complete**.
- The revealed flop on felt.
- The serif result line ("High card."), then the winnings in accent, or a calm "Not this time" line.
- A receipt: Prediction · Used · Returned.
- **Next round** and **View activity**.

### Activity — "Your activity."
- The eyebrow "EVERY ROUND, IN THE OPEN".
- A four-cell stat strip: Predictions · Correct predictions · Hit rate · Net chips.
- Tabs: **All rounds · Correct · Not matched · Ledger**.
- Round cards: the table, round, time and result, a mini flop, and each bet with its stake, locked odds and Won/Lost/Void.
- Empty state: "Your story starts with three cards." with **Find a table**.

### Profile — "Your profile."
- The eyebrow "MAKE YOURSELF AT HOME".
- **Identity card:** the avatar, the name and **PRACTICE PLAYER**, and an editable **Display name** (`PATCH /v1/me`).
- **Balance card:** the chip, "YOUR PRACTICE BALANCE", a large serif number and **Reset free chips**.
- **A game on your terms.** and **Your six favorites**, with **Manage favorites ›**.
- Organizer wallets.
- Collapsible sections: Join a room · Become an organizer · Sign-in & security (change password; add a missing date of birth or country once) · Responsible play (limits, session time limit, self-exclusion) · Identity & payments.
- In every app screen: a banner until the email is confirmed (with **Send the link again**), a session clock in the top bar, and a reality check every session limit (or 60 minutes) with the time played, the net result of the session, **Continue** and **Take a break**.
- **Sign out**.

## Odds

The concepts' odds are illustrative. The app always shows the engine's real prices from `GET /v1/book`. Those prices have the house edge applied and are proven by the odds book. Odds display as decimal "×" values that include the stake (`formatOdds`).

## The design system page

The console serves a live reference at **`/design`** (public, no sign-in). It renders the real components, so it cannot drift from the apps. It covers:
- **Principles:** calm, honest numbers, simulated tables labelled, one system.
- **Colour:** every token, with values read from the running page, and the felt themes.
- **Type** scale.
- **Components:** buttons, badges and pills, status dots, presets and tabs, callouts, the balance chip and the empty state.
- **Cards and tables:** playing cards, lobby table cards and favorite tiles.
- **Dashboard pattern:** an eyebrow, a serif title, a strip of key numbers, then section cards.
- **Layers and roles:** the six surfaces with their live navigation, and the PreFlop team access matrix as the API enforces it.

The felt (`Felt`, `feltTheme`, `feltLabel`) now lives in `packages/ui`. The player app and the console table wall share it.

## Console (dashboards)

The four portals use the same language:
- the left rail with the wordmark and an active item in `accent-deep`;
- a top bar with the portal name and a role pill (**SUPER ADMIN** for the `admin` platform role; OWNER, ADMIN or VIEWER inside an organization);
- page headers with a mint eyebrow and a serif title;
- key-number cards with serif figures;
- section cards with bold sans titles.

The PreFlop team's table wall shows each table on its club's felt.

## Roles

| Layer | Roles | Who can change things |
|---|---|---|
| PreFlop team | `admin` (super admin), `ops`, `risk`, `support` | Settings and team roles: super admin only. Voiding rounds and pausing tables: admin, ops, risk. Users' status and KYC: admin, risk, support. Organizations and applications: admin, ops. Ledger: admin, ops, risk. Audit: admin, risk. The full matrix is on `/design`. |
| Club, partner, organizer | owner, admin, viewer | Owner and admin change things. Viewer is read-only. |
| Club tablet | dealer, floor, floor manager | Signed device keys, enrolled per table |

## Beyond the concepts

The concepts cover the player in play mode. The other surfaces apply the same tokens and components:
- the website;
- the console portals (PreFlop team, poker clubs, partners, organizers);
- the club tablet.

On desktop the console uses a left sidebar layout.
