# 12 — Table Hardware and Security Setup

This is the physical and technical setup every PreFlop table must have. **The flop capture is what pays every bet,** so the whole chain from deck to settlement is treated with the same care as money:

> shuffler → cut → cards on the table → camera → Table Box → PreFlop server

Status: proposed standard. Product names are examples to evaluate with vendors and the regulator. Prices are rough estimates.

## 1. What we are protecting against

| Threat | Real-world precedent | Main defences |
|---|---|---|
| **Tampered shuffler** that reads or arranges the deck order | Researchers showed in 2023 that a DeckMate 2 could be hijacked through an exposed USB port, and that its internal camera could leak the full deck order in real time ([IOActive at Black Hat, reported by Bitdefender](https://www.bitdefender.com/blog/hotforsecurity/how-to-hack-casino-card-shuffling-machines/), [Kaspersky](https://me-en.kaspersky.com/blog/hacked-card-shufflers/24971/)). In 2025 the FBI charged 31 people over rigged games that used modified DeckMate shufflers ([NBC News](https://www.nbcnews.com/business/business-news/tech-mafia-nba-rigged-poker-rcna239362?rand=14095), [WHRO/NPR](https://www.whro.org/2025-10-24/fbi-says-card-shuffling-machines-were-hacked-as-part-of-major-illegal-gambling-schemes)) | **No complete defence exists at the table — see §2a.** A PreFlop-owned, certified Trusted Shuffler (§2a), sealed and inspected (§2) · sequential outcome-frequency monitoring with automatic pause · exposure and long-shot limits · payout holds. The random cut (§6) is only a minor extra control: it does **not** defeat a shuffler that controls the deck order |
| **Forged or edited flop result** | — | PreFlop-owned, locked-down **Table Box** (§4) · **signed, hash-chained captures** checked against independent dealer and floor entries (§5) |
| **Hole-card information leak** | A livestream's RFID hole-card data was allegedly misused by an insider ([PokerNews](https://www.pokernews.com/news/2019/10/graphics-company-mike-postle-cheating-allegations-35609.htm)) | PreFlop **never reads hole cards**. No hole-card RFID or cameras · betting closes before hole cards are dealt |
| Dealer or staff collusion | — | Per-person staff credentials with separated roles (`docs/13` §7), dealer rotation, camera on the dealer's hands, staff banned from betting, payout holds on anomalies, random cut |
| Network attack or a slow stream | — | Outbound-only encrypted links, separate network segments, backup line, live health checks (`docs/11`) |
| Power loss | — | UPS on every table component; a round is voided if its result can't be verified |

## 2. Shuffler and cards

| Tier | Shuffler | Use |
|---|---|---|
| **Certified** (real money) | **Light & Wonder DeckMate 2**, or an equivalent approved model with **card recognition**, so every shuffle confirms that all 52 cards are present. It shuffles a deck in about 22 s ([Wikipedia](https://en.wikipedia.com/wiki/Deck_Mate)). New units cost over $20,000 and are sold only to licensed operators ([Bitdefender](https://www.bitdefender.com/blog/hotforsecurity/how-to-hack-casino-card-shuffling-machines/)) | Real money: fiat and crypto |
| **Social** (chips, diamonds, play) | A professional single-deck poker shuffler, for example the **Shuffle Tech ST1000**. It is cheaper but jams more often and needs poker-size cards ([PokerChipForum](https://www.pokerchipforum.com/threads/automatic-card-shufflers-for-home-games-%E2%80%94-worth-it.141305/)). If the model has no data output, the Table Box gets *shuffle complete* from a PreFlop sensor on the shuffler's output tray | Chips, diamonds, play money |

**Hardening, required for every shuffler:**
1. **Supply chain.** Buy only from the manufacturer or an authorized distributor. Record the serial number and firmware version at installation; PreFlop checks the firmware version against the vendor's published release.
2. **Ports sealed.** USB, service and network ports are blocked and covered with **numbered tamper-evident seals**. Seal numbers are checked and logged on the tablet at the start of every shift (`shufflerSealsVerifiedThisShift`). A broken seal takes the table offline until a PreFlop technician inspects it.
3. **Locked enclosure.** The shuffler sits in a locked under-table compartment. Keys stay with the floor manager, and every opening is logged.
4. **No wireless near the machine.** The shuffler has no Wi-Fi or Bluetooth connection. A periodic RF scan near the table looks for hidden transmitters.
5. **Camera coverage.** Camera C3 records the shuffler and the dealer's hands at all times (§3).
6. **Inspections.** A PreFlop technician inspects every unit each quarter (internals, firmware, seals), and again after any service.

**Cards:**
- 100% plastic, casino-grade, poker size, **large index** (easier for the camera to read).
- Two decks with different back colours, used in turn.
- Opened from sealed packs, with pack numbers logged. Decks are replaced every shift, or immediately if one is damaged or marked.

## 2a. Shuffle assurance: the open integrity risk

**A random cut does not protect against a shuffler that controls the deck order.** This was shown by the external audit of 2026-10-02 and is reproduced in `packages/odds-engine/test/audit-2026-10-02.test.ts`.

**Why the cut fails.** With 9 seats, the flop is dealt from positions 19–21 after the cut. Across every allowed cut (15–37 cards), those three positions only ever fall on 25 distinct places in the deck. A rigged shuffler can put 25 of the 26 red cards in exactly those places. Then **every** allowed cut produces an all-red flop. An accomplice does not need to know the exact cards, only that "all red" will win.

**The same trick works on any rule about groups of cards:** colour, suit, high/low, "no pair". No re-shuffle by rotation (a cut of any depth, at any time) can fix this. Only randomness that changes the cards' **order relative to each other**, from a source the attacker cannot control, removes the threat.

**Required before any value-bearing wagering on a physical table** (real money, crypto, and chips or diamonds bought with money):
1. **PreFlop Trusted Shuffler.**
   - PreFlop supplies and owns it; the club cannot open, service or configure it.
   - It has no output of the deck order (no card-reading data path, no USB, no wireless).
   - Firmware is signed by PreFlop, and the Table Box attests to it before every session.
   - Its randomness comes from an internal hardware random number generator.
   - It shuffles **one deck per hand**, **after Start hand**, on a single-use command nonce from PreFlop, and signs its completion with that nonce. So no deck order exists while bets are open, no pre-shuffled deck waits in a tray the club can reach, and a replayed or pre-arranged shuffle is detectable. The full sequence is in §6 and `docs/13` §4.
   - The model and its shuffle algorithm are **certified by an accredited gaming test laboratory**, covering both its RNG and how well it shuffles.
2. **Outcome monitoring.** For every table and every market family, run sequential tests (for example CUSUM or SPRT) on outcome frequencies against the exact probabilities.
   - A stacked deck that forces "all red" (11.8% per flop) would trip the test within a few hands. Five in a row has a probability of about 2 × 10⁻⁵.
   - When the test trips: the table pauses automatically, payouts are held, and the shuffler and table are inspected.
3. **Limits.** Per-round, per-market and per-account stake caps, tighter on long shots and on market families an attacker could target. Linked-account clustering, and payout holds on wins that look anomalous.
4. **Independent threat-model review** of this section, plus adversarial testing of the Trusted Shuffler, before go-live.

**Physical-table play is disabled in every mode, including non-redeemable play money** (owner decision, re-audit of 2026-10-02; `docs/06`, decision 7). Having all four in place is a **prerequisite for reconsidering** that decision, not permission to enable physical play automatically. Seals, cameras and the cut lower the risk, but they do **not** make the published probabilities a guarantee. Until then PreFlop runs on the **simulated table** only; simulated practice play is a separate scope.

## 3. Cameras: what to buy and how to install them

| Camera | Purpose | Spec (minimum) | Installation |
|---|---|---|---|
| **C1 Board camera** | Reads the flop and records the evidence image | 4K (3840×2160) sensor, fixed lens, global or fast shutter, PoE IP camera with ONVIF, H.265, hardware timestamps | **Directly overhead**, centred on the board area, **1.2–1.5 m** above the felt, on a rigid ceiling mount or boom with no vibration. Covers the five board-card positions and the burn spot only |
| **C2 Dealer camera** | The main live view: the dealer dealing | 1080p60 (4K optional), wide dynamic range, PoE, ONVIF | **High on the ceiling opposite the dealer, about 2.2–2.5 m up, tilted steeply down (about 55–65°)** and framed tightly on the dealer zone: dealer, chip tray, shuffler and board. Pointing down and away means the players opposite are behind or below the frame. Seats next to the dealer are covered by privacy masks |
| **C3 Shuffler camera** | Live close-up of the shuffler and the cut, plus evidence of shuffle, Start hand and cut depth | 1080p (streamed at 720p), close-up | Side-mounted at the dealer's position, aimed only at the shuffler, the dealer's hands and the cut card |
| **C4 Room CCTV** | General security (players, phones, staff) | Club's own system, recordings kept for at least 30 days | Covers the table area and the shuffler cabinet |

**Installation rules:**
- **No camera can see hole cards or players.** At certification a technician places a card face-up at every seat, and people sit in every seat. The technician checks every feed to confirm neither cards nor players are visible. Privacy masks enforce this (§3a).
- **Lighting:** diffused LED, 5000 K, at least 800 lux on the felt, no hotspots or glare. Use matte, non-reflective felt.
- **Mounts:** steel, tamper-proof screws, cables in conduit, camera housings sealed. Cameras are serial-registered to the table.
- **Camera network:** cameras connect **only** to the Table Box on their own isolated network (§4). Each camera's default password is replaced, its cloud and P2P features are disabled, and its firmware is pinned to a version PreFlop has checked.
- **Calibration:** at the start of each shift the dealer lays out a set of test flops. The Table Box must read every one correctly (`boardCameraCalibrated`).

**Card reading:** the main source is computer vision on C1, running on the Table Box. An optional upgrade is **board-only RFID**: antennas only under the community-card area, never under player seats. Either way, each flop is confirmed by **three independent sources**: the camera (or RFID) reading, the dealer's entry, and the floor supervisor's entry.

## 3a. The live stream: what viewers see

**Live streaming is mandatory.** A table that is not on air cannot open betting (`streamLive` in `checkLink()`). If the stream drops, the table pauses at once.

Viewers always see **the dealer, the shuffler, the cards and the flop**, and **never the players**.

```
                    C2 (ceiling, opposite the dealer, steep down-angle)
                     │  frames ONLY the dealer zone
          seat 5   seat 4 │ seat 6          ← behind / below C2's frame: never on stream
     seat 3                             seat 7
          ┌───────────────────────────────┐
     seat 2│      [ B O A R D ]  ← C1 overhead │seat 8     masked zones: every seat area
          │                               │
          └──────────[ DEALER ]───────────┘
     seat 1 ▒▒▒    [chip tray] [SHUFFLER] ← C3   ▒▒▒ seat 9   (seats next to the dealer: masked)
```

**What viewers watch.** The Table Box produces the programme automatically from round events:

| Moment | Main picture | Picture-in-picture |
|---|---|---|
| Betting open (hand N playing) | C2 dealer view | C1 board |
| Shuffle complete, Start hand, cut | C3 shuffler and cut close-up | C2 |
| Deal | C2 dealer view | C1 board |
| Flop | **C1 board full screen**, with the flop and bet results overlaid | C2 |

Viewers can also switch to a multi-view of all three feeds.

**Privacy protection (players are never streamed):**
1. **Framing:** C2 and C3 are aimed only at the dealer zone and shuffler, and C1 only at the felt.
2. **Fixed privacy masks:** every seat area is blacked out on the Table Box **before encoding**, so unmasked pictures of players never leave the table.
3. **Live person detection** on every streamed frame, plus a check that each camera's framing still matches its certified reference image. If anyone appears outside the dealer zone, or a camera is bumped, the stream **switches to the board-only view at once** and alerts the floor (`streamPrivacyDecision()`). Betting continues, because the board camera only sees the felt.
4. **Certification test:** people sit in every seat, and the technician confirms nobody is visible in any streamed feed (`privacyMasksVerified`). This is repeated after any camera change.
5. **Consent:** dealers agree to being streamed in their contract. Signs in the room say that the dealer area is broadcast and that players are not.

**Delivery:**
- The Table Box encodes the feeds (H.264, 1-second keyframes) and sends them over **SRT** (encrypted, recovers from packet loss) to PreFlop's media servers.
- Viewers receive them over **WebRTC** (under 1 s delay) or **LL-HLS** (about 2–3 s) as a fallback.
- Target: **3 s or less** from camera to viewer (`docs/11` §3).

**Bandwidth per table:**

| Feed | Bitrate |
|---|---|
| C2 1080p60 | ~6 Mbps |
| C1 1080p | ~3 Mbps |
| C3 720p | ~1.5 Mbps |
| Evidence stills, about 2 MB per flop | negligible |

That is ~12 Mbps in total, so the requirement is **20 Mbps sustained upload** per table. The 5G backup must carry at least the main programme (about 8 Mbps).

## 4. The PreFlop Table Box: the machine that connects cameras to PreFlop

PreFlop owns, configures and ships this device. **The club never has administrator access.**

**Hardware:**
- Fanless industrial PC with **TPM 2.0**, a hardware video encoder and two Ethernet ports.
- Chassis intrusion switch: if the case is opened, the device raises an alarm and locks its keys.
- Firmware (BIOS) password set, and booting from USB disabled.
- **USB ports disabled in firmware and physically blocked.** No Wi-Fi or Bluetooth module is fitted.
- Installed in a **locked, ventilated cabinet** that camera C4 can see.

**Software:**
- A minimal Linux image signed by PreFlop, with **Secure Boot**, a read-only system partition and full-disk encryption sealed to the TPM.
- Updates are signed and installed to a second partition (A/B), so a failed update rolls back automatically.
- No SSH, no remote desktop, and **no open incoming ports**.
- The only outside connection is **outgoing**: mutual-TLS from the box to PreFlop, using a device certificate whose private key lives in the TPM and cannot be copied out.
- **Remote attestation** at every boot and every hour: the box proves to PreFlop that it is running the approved software. If it fails, the table stops opening rounds (`tableBoxAttested`).

**Network layout:**

```
[C1][C2][C3] ── camera network (isolated, no internet) ── Table Box ── uplink (outgoing only) ── firewall / dual-WAN router ── fibre + 5G
[dealer tablet][floor tablet] ── staff network (outgoing to PreFlop only)
[club Wi-Fi / guests] ── fully separate; no route to the table networks
```

**Time:** the box keeps time through authenticated NTP (NTS) from PreFlop, with GPS as an option. A box whose clock drifts more than 2 s is taken out of service.

**Storage:**
- Evidence is uploaded to PreFlop's **write-once (WORM) storage** with object lock, kept for at least 5 years or as long as the regulator requires.
- A local encrypted buffer holds 30 days of evidence in case the uplink is down.

**Monitoring:** heartbeat, link stats, temperature and the enclosure sensor are reported every second. Any tamper signal → **key revoked → table offline → technician visit**.

## 5. Signed flop evidence: how a capture is trusted

The code is in `packages/odds-engine/src/evidence.ts`, with tests.

**On the Table Box, for each flop:**
1. Capture the full-resolution C1 image and compute its SHA-256 hash.
2. Read the cards using vision (or board-only RFID).
3. Build the capture record:

   ```
   { deviceId, tableId, roundId, handNo, cards, source, imageSha256, capturedAt, seq, prevHash }
   ```

   `seq` increases by 1 every time. `prevHash` is the hash of this box's previous record, so the records form a chain.
4. Sign the record with the box's **Ed25519 key held in the TPM**.
5. Send the record and the image to PreFlop. The image goes to WORM storage.

**On the PreFlop server (`verifyCapture`):** the server **rejects** the capture if any of these is true:
- the device is unknown, revoked, or not bound to this table;
- the signature does not match;
- the capture is for a different round, table or hand;
- `seq` has a gap or repeats an old record, or `prevHash` breaks the chain;
- it was captured before the lock or deal-start, or too long after deal-start;
- the uploaded image does not match the signed hash;
- the cards are unreadable or duplicated.

If the capture is authentic but the camera reading **differs from the dealer's or floor's entry**, the round goes to **manual review** and is never settled automatically. Only a verified capture that **matches both** independent entries settles the bets.

A round left in review is voided and refunded automatically at the review deadline (30 minutes after it entered review). The floor manager's tablet shows a live countdown to that deadline on the Review tab, warns when less than 2 minutes remain, and says so when a hand was auto-voided. A new review never pulls the manager off the screen they are using: it appears as a badge on the Review tab and a banner. Before *Settle with cards* the manager must confirm they checked the verified board camera image; when there is no image, the confirmation says so explicitly and needs a press-and-hold. Evidence is loaded per hand: switching hands cancels the earlier request and ignores a late answer, and *Settle* / *Void* stay disabled until the evidence on screen belongs to the selected hand. A tablet action counts as done only when the server's answer carries that action's acknowledgement; an unreadable success answer (an HTML page, an empty or cut-off body) shows *no confirmation* with a Retry that resends the same Idempotency-Key, so the action never runs twice.

Tests confirm each case: edited cards, a swapped image, a wrong key, a revoked device, a replayed record, a broken chain, an early capture, and a dealer mismatch.

## 6. Per-hand procedure

```
1  dealer:   presses START HAND   ══ LOCK: bets on this flop close (no deck order exists yet) ══
2  PreFlop:  issues a single-use shuffle command nonce to the Trusted Shuffler (via the Table Box)
3  shuffler: FRESH shuffle of one deck for that command; signs completion {hand, nonce}; Table Box forwards it
4  PreFlop:  draws a random cut depth (15–37 cards) and shows it on the dealer tablet
5  dealer:   cuts at that depth with a cut card and presses CUT   (C3 records it)
6  dealer:   deal-start → hole cards → burn → FLOP
7  Table Box: signed capture of the board   ·   dealer and floor enter the flop on their tablets
8  PreFlop:  verifies the signature, chain, timing and image hash, and checks the 3-way match → settle, or send to review
```

The backend enforces the steps as substates with server-assigned ordinals. Any missing or out-of-order step, a shuffle signal that did not come from the machine, or a completion that does not attest this hand's nonce **voids the round and refunds every bet** (`handProcedureProblems`).

The random cut makes it harder to aim at one **exact** card position. It does **not** stop a shuffler that controls the deck order from rigging rules about groups of cards (colour, suit, high/low); see §2a. Shuffle integrity rests on the Trusted Shuffler and on outcome monitoring, not on the cut.

## 7. Per-shift checklist (dealer tablet, signed by the floor manager)

1. Shuffler seals intact; seal numbers entered.
2. Deck packs opened, numbers logged, and the shuffler's card check passes.
3. Board camera test flops read correctly.
4. Table Box attestation passes and its clock is in sync.
5. Connection healthy: main and backup lines up; video delay under 3 s.
6. UPS charged and on mains power.
7. Dealer roster logged; dealers rotate every 30 minutes.

## 7a. Staff tablets: PIN lock and lost tablets

Each staff tablet holds one person's signing key for one table and role (non-extractable WebCrypto Ed25519 key in the browser's IndexedDB). On top of that:

- **Staff PIN.** Enrollment ends with the person choosing a 6–8 digit PIN (no repeated digits or runs). Only a salted PBKDF2-SHA-256 hash (210,000 iterations) is stored next to the key; the PIN never leaves the tablet.
- **Auto-lock.** The tablet locks after 5 idle minutes (2, 5, 10 or 15 in the tablet settings), when it returns to the foreground after being idle that long, after every reload, and on *Lock now*. While locked, the table screens are not shown and **nothing is signed**: the app refuses to sign any request (polls included) until the PIN is entered. After 5 wrong PINs each try waits 30 s, doubling up to 15 minutes; the count survives a reload.
- **Press and hold.** Every signed step of a hand (START HAND, CUT, DEAL START and the flop submission) is press-and-hold, so a stray tap never signs.
- **Forgotten PIN.** It cannot be recovered: *Reset this tablet* deletes the key and PIN, then the club admin revokes the old credential and enrolls a new key.
- **Who the tablet signs as.** The tablet's settings (gear icon) show the person, role and **credential id** it signs with, so a shift lead can check a tablet at handover. One tablet key belongs to one person: the next shift does not use it, they enroll their own key (there is no switching between people on one tablet).
- **Reset reminder.** Resetting a tablet deletes its key but does not revoke the credential on the server. The reset confirmation names the credential id to revoke, and the tablet keeps showing *Old credential still active* (credential id, person, role, table) on its setup, enrollment and settings screens until someone confirms, by press-and-hold, that the club admin revoked it.

The PIN stops someone walking past an unattended tablet. It is not encryption: anyone who can run code in that browser profile can use the key directly. A tablet that leaves the club's control is therefore always revoked server-side.

### Runbook: revoke a lost or stolen tablet

1. **Revoke now, investigate later.** In the club console, *Staff & devices → Staff credentials*, find the tablet's credential and press **Revoke**. The list shows person, role, table, enrollment date and status (not the credential id), so match the person, role and table that the tablet's settings or its *Old credential still active* reminder showed; if one person has several active rows for that table and role, revoke all of them that are not on a tablet still in hand. Revocation is immediate: every later request signed with that key is refused with `credential_revoked`. If several tablets went missing, revoke each credential.
2. **Check the table.** If the lost tablet was the only dealer, floor or floor-manager credential for its table, the table cannot run hands: enroll a replacement (step 4) or pause the table from the floor manager's tablet (or ask PreFlop operations) until one is ready. Open rounds are protected anyway: a round that cannot finish its procedure is voided and refunded (§6).
3. **Review what it signed.** In the back office, check the table's recent rounds and the audit log for actions by that credential since the tablet was last seen (start, cut, deal-start, flop entries, reviews). Raise an alert with PreFlop risk if anything was signed after the loss was noticed.
4. **Enroll a replacement.** On a clean tablet: *Set up this table tablet* (table id, person, role) → *Create tablet key* → read the fingerprint aloud to the club admin, who enrolls the public key (*Staff & devices → Enroll staff*) → enter the credential id → the person sets a new PIN. Never reuse the old credential id.
5. **If the tablet is found.** Do not reuse it as-is: open its settings, *Reset this tablet* (deletes the old key), and enroll it again as a new credential. The tablet then shows the old credential id to revoke (step 1) until the revoke is confirmed.

## 8. Rough equipment cost per table (estimates)

| Item | Certified | Social |
|---|---|---|
| Shuffler | $20,000+ (DeckMate 2) | a few thousand dollars (single-deck model) |
| Cameras C1–C3 and mounts | €2,000–4,000 | €1,000–2,000 |
| Internet: fibre with ≥ 20 Mbps upload + 5G backup | monthly, per room | monthly, per room |
| PreFlop Table Box (TPM, encoder) | €1,500–2,500 | €1,000–1,500 |
| Dual-WAN router, firewall, UPS | €800–1,500 per room | €500–1,000 per room |
| Tablets (dealer and floor) | €600–1,000 | €600 |
| Optional board-only RFID kit | €3,000–8,000 | — |

The PreFlop subscription can bundle the Table Box and its configuration, since PreFlop must own that device anyway.

## 9. Audit

- **Before go-live:** certification visit and a 30-minute connection test.
- **Ongoing:** PreFlop checks remotely every shift; a technician visits every quarter.
- **Every year:** an independent penetration test of the Table Box, the network and the Provider API. A bug-bounty programme is recommended.
- All events, signatures and evidence are retained for regulators.
