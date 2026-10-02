# 15 — App design (from the Codex mobile concepts)

The player app follows three concept sheets prepared by Codex: **"Mobile concept 01"**, **"Clubs & tables"** and **"Your favorite bets"**. They are mobile-first, dark, and calm. This document records what they show so every frontend matches them. The tokens live in `packages/ui/src/tokens.css`; the shared components live in `packages/ui/src/index.tsx`.

## Visual language

- **Surfaces:** near-black background (`bg`). Cards are `surface`, with a hairline `line` border and 18 px radius. Tiles use 14 px.
- **Accent:** emerald green (`accent`, #1fd38b) for primary buttons, selected states (glow ring plus a check badge), "Predictions open" dots and active tabs. Text on accent is `accent-ink` (dark).
- **Felt:** a radial green felt gradient (`.felt`) behind the face-down flop and the table hero image.
- **Type:**
  - The **"PreFlop" wordmark is serif** (`font-serif`).
  - Large headings ("Find your table", "Atlas Poker Club", "Club tables", "Predict the next flop", "Favorite bets", "Browse bets", "Replace a favorite") are serif.
  - Everything else is sans (Inter).
- **Top bar** on every screen:
  - the serif wordmark at left;
  - an outlined **PRACTICE** pill in accent (shown while the user is in play-money mode);
  - a round avatar at right.
- **Balance card** under the top bar:
  - a poker-chip icon (`ChipIcon`) and a big number, e.g. "10,000";
  - the label "Free chips";
  - a muted two-line tagline at right ("Play. Practice. Get better." / "Same hands. More experience." / "Good instincts add up.").
  - Inside a table, the card shows the table name ("Table 04 · Atlas Poker Club · Example organizer") with the balance at right.
- **Bottom tab bar**, 5 tabs: **Lobby · Clubs · Table · Activity · Profile**. The active tab is accent with a filled icon. "Table" uses a chip icon. An earlier concept had three tabs (Play · Activity · Profile); the five-tab version is the target.
- **Footer microcopy** under primary actions: "Free chips. No cash value." (play money). Wording must never suggest cash value in play mode.
- **Demo labels:** "DEMO STREAM" badge with a red live dot on stream thumbnails; "Simulated table" subtitle for practice tables. Physical-table play is disabled for now (`docs/06` #7), so every live table in the app today is a **simulated table**, and it must say so.

## Screens

### 1. Choose your table (concept 01, screen 1)
- The heading is **"Choose your table"**, with the small muted note "Two tables. Same game. Your pace."
- Large table cards:
  - **The Green Room**: "Simulated table", "24k+ plays today", a felt image with three fanned card backs, the copy "Sharpen your instincts with a classic table." and a big green **Play ›** button;
  - **Midnight Room**: "Practice at your pace", "A relaxed table for casual play." and a chevron button.

### 2. Find your table / Lobby (clubs & tables, screen 1)
- Serif heading **"Find your table"**.
- A search field: "Search clubs or tables".
- Filter pills: **All clubs** (selected, filled accent), **Available**, **☆ Favorites**.
- Table cards:
  - a stream thumbnail with the last flop, a "DEMO STREAM" badge and a "PreFlop" watermark on the felt;
  - the title "Table 04" and "Organized by Atlas Poker Club";
  - the location with a pin ("Bucharest");
  - a status dot: green **"Predictions open"** or blue **"Round in progress"**;
  - a CTA: **Open table ›** (filled) or **View table ›** (outlined).

### 3. Club page (clubs & tables, screen 2)
- A back arrow and the balance card.
- The club header: a circular monogram ("A") with an accent ring, the serif name "Atlas Poker Club", "Bucharest · Example club", "Organizer", and a star (favorite) button.
- **"Club tables"** with a count ("3 tables").
- Rows: a thumbnail at left (a DEMO badge and the last flop, or a struck-camera icon for "Stream unavailable"), the title, a status dot, the city, and a CTA (**View table ›**).

### 4. Table: predict the next flop (clubs & tables, screen 3, and concept 01, screen 2)
- The top card shows the table name and organizer.
- A **stream area**: the felt with the **previous flop** face up, a "DEMO STREAM" badge, the "PreFlop" watermark and an expand button.
- Under it: "Previous flop · Round 024".
- A **stepper: Open → Locked → Reveal** (`RoundStepper`).
- The serif heading **"Predict the next flop"**, with "Round 025 · Predictions open" under it.
- A **2×2 grid of prediction tiles**, each with an outline icon, a title and a subtitle:
  - Pair: "Two of a kind";
  - Flush: "Three of the same suit";
  - Straight: "Three in sequence";
  - High card: "No pair, flush or straight".

  The selected tile has an accent border with a glow and a check badge.
- **"Free chips"** stake selector: **50 · 100 · 250** pills (`Segmented`).
- A big **Confirm prediction** button, then "Free chips. No cash value."
- The concept 01 variant also has a **"Your prediction"** summary card (an icon, the title, the subtitle and an "Edit" link) above the stake.

### 5. Favorite bets (favorite bets, screen 1)
- **"Favorite bets 6 / 6"** with an **Edit** button.
- A 2×3 grid of tiles. Each tile shows: an icon, the name ("Any pair"), the category ("Rank pattern"), **odds as "5.20×"**, and a filled accent star. The selected tile has a check badge.
- **Browse all bets ›** (an outlined, full-width button with a search icon).
- The stake pills, then **"Confirm · 100 free chips"**, then "No cash value."

### 6. Browse bets (favorite bets, screen 2)
- A back arrow, then the heading **"Browse bets"** with the subtitle "Choose a bet, then save it to a favorite slot."
- A search field: "Search bets".
- Category pills:
  - **All** (selected), **Patterns**, **Colors**, **Suits**;
  - **Ranks**, **Sequences**, **More ▾**.
- A sectioned list (COLOR, RANK PATTERN, SUIT…). Each row has:
  - an icon, the name and a muted description;
  - **odds "7.50×"**;
  - a star (filled = favorite), then a chevron.
- Tapping an unstarred row highlights it, with the hint "ⓘ Tap star to add to favorites".
- Footer: "Decimal odds include your chip stake."

### 7. Replace a favorite (favorite bets, screen 3)
- Shown when all 6 slots are full.
- The heading **"Replace a favorite"**, then "All 6 slots are full. Choose which one to replace."
- The new bet's card at the top.
- A grid of the current favorites, each with a radio. The selected one is labelled **Replace this**.
- A preview row: "Any flush 18.00× → Exactly two red 2.40×".
- **Replace favorite** (filled), **Cancel** (outlined), then "Your other favorites stay unchanged."

### 8. Round complete (concept 01, screen 3)
- Header: **"Round complete"**.
- The revealed flop, large and face up on felt.
- A big result line: **"A pair."**, then **"+200 free chips"** in accent. A loss shows a neutral line instead.
- A summary card: **Prediction** (Pair), **Used** (100), **Returned** (300).
- **Next round** (filled), **View activity** (outlined), then "Free chips. No cash value."

## Odds

The concepts' odds are illustrative. The app always shows the engine's real prices from `GET /v1/book`. Those prices have the house edge applied and are proven by the odds book. Odds display as decimal "×" values that include the stake (`formatOdds`).

## Beyond the concepts

The concepts cover the player in play mode. The other surfaces apply the same tokens and components:
- the website;
- the console portals (PreFlop team, poker clubs, partners, organizers);
- the club tablet.

On desktop the console uses a left sidebar layout.
