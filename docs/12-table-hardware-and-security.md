# 12 — Table Hardware and Security Setup

This is the physical and technical setup every PreFlop table must have. **The flop capture is what pays every bet,** so the whole chain from deck to settlement is treated with the same care as money:

> shuffler → cut → cards on the table → camera → Table Box → PreFlop server

Status: proposed standard. Product names are examples to evaluate with vendors and the regulator. Prices are rough estimates.

## 1. What we are protecting against

| Threat | Real-world precedent | Main defences |
|---|---|---|
| **Tampered shuffler** that reads or arranges the deck order | Researchers showed in 2023 that a DeckMate 2 could be hijacked through an exposed USB port, and that its internal camera could leak the full deck order in real time ([IOActive at Black Hat, reported by Bitdefender](https://www.bitdefender.com/blog/hotforsecurity/how-to-hack-casino-card-shuffling-machines/), [Kaspersky](https://me-en.kaspersky.com/blog/hacked-card-shufflers/24971/)). In 2025 the FBI charged 31 people over rigged games that used modified DeckMate shufflers ([NBC News](https://www.nbcnews.com/business/business-news/tech-mafia-nba-rigged-poker-rcna239362?rand=14095), [WHRO/NPR](https://www.whro.org/2025-10-24/fbi-says-card-shuffling-machines-were-hacked-as-part-of-major-illegal-gambling-schemes)) | Sealed and inspected shuffler (§2) · **random cut chosen by PreFlop after betting closes** (§6) · statistical monitoring · exposure limits |
| **Forged or edited flop result** | — | PreFlop-owned, locked-down **Table Box** (§4) · **signed, hash-chained captures** checked against independent dealer and floor entries (§5) |
| **Hole-card information leak** | A livestream's RFID hole-card data was allegedly misused by an insider ([PokerNews](https://www.pokernews.com/news/2019/10/graphics-company-mike-postle-cheating-allegations-35609.htm)) | PreFlop **never reads hole cards**. No hole-card RFID or cameras · betting closes before hole cards are dealt |
| Dealer or staff collusion | — | Random cut, dealer rotation, camera on the dealer's hands, staff banned from betting, payout holds on anomalies |
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

Tests confirm each case: edited cards, a swapped image, a wrong key, a revoked device, a replayed record, a broken chain, an early capture, and a dealer mismatch.

## 6. Per-hand procedure

```
1  shuffler: shuffle complete (machine signal, usually during the previous hand)
2  dealer:   presses START HAND, takes the deck   ══ LOCK: bets on this flop close ══
3  PreFlop:  draws a random cut depth (15–37 cards) and shows it on the dealer tablet
4  dealer:   cuts at that depth with a cut card and presses CUT   (C3 records it)
5  dealer:   deal-start → hole cards → burn → FLOP
6  Table Box: signed capture of the board   ·   dealer and floor enter the flop on their tablets
7  PreFlop:  verifies the signature, chain, timing and image hash, and checks the 3-way match → settle, or send to review
```

Any missing or out-of-order step, or a shuffle signal that did not come from the machine, **voids the round and refunds every bet** (`handProcedureProblems`).

Because the cut depth is chosen **after** betting closes, someone who knew the full shuffled order still could not tell which three cards would reach the flop when they placed their bet.

## 7. Per-shift checklist (dealer tablet, signed by the floor manager)

1. Shuffler seals intact; seal numbers entered.
2. Deck packs opened, numbers logged, and the shuffler's card check passes.
3. Board camera test flops read correctly.
4. Table Box attestation passes and its clock is in sync.
5. Connection healthy: main and backup lines up; video delay under 3 s.
6. UPS charged and on mains power.
7. Dealer roster logged; dealers rotate every 30 minutes.

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
