# 11 — Club Requirements: Shuffler, Cut and Connectivity

Every club table must be **certified** before it can host PreFlop rounds, and must stay healthy while live. The code is in `packages/odds-engine/src/tableReadiness.ts`, and the thresholds below are placeholders set there.

## 1. Mandatory equipment and procedure

| Requirement | Why | How it's enforced |
|---|---|---|
| **Automatic shuffling machine** (approved model, serial registered, paired with the table device) | A human shuffle can be manipulated; a machine gives a random, auditable deck | The shuffler sends `shuffle-complete` for every hand. A signal typed in by staff does not count |
| **Dealer cuts the deck before every hand, at a random depth chosen by PreFlop after betting closes** | Even someone who knew the shuffled order cannot know which cards reach the flop | The tablet shows the cut depth; the dealer cuts with a cut card and presses **Cut**. Camera C3 records it. Order is enforced: shuffle → lock → cut instruction → cut → deal |
| **Stable, tested internet with a backup line** | Players must see the table with minimal delay, and betting state must never depend on a slow stream | Connection test at onboarding, then live monitoring every few seconds |
| **Approved cameras** | The flop area must be clearly visible; hole cards must never be exposed | Camera angles reviewed at certification |
| **Trained dealers** | Correct Start hand, cut and flop entry | Training sign-off for each dealer |

## 2. Per-hand sequence

```
shuffler: shuffle-complete ─► dealer: Start hand ══ LOCK ══ ─► PreFlop: random cut depth ─► dealer: cut ─► deal-start ─► hole cards ─► flop
```

- Bets on flop N+1 are open while hand N plays out. They close when the dealer presses Start hand for hand N+1, before any hole card exists (`docs/04` §4).
- If the shuffle signal is missing, did not come from the machine, or the cut is missing or out of order, then **every bet on that flop is void and refunded** (`handProcedureProblems()`).

## 3. Connectivity

**Onboarding test.** A 30-minute connection test on the table's network, repeated after any network change:

| Measure | Required |
|---|---|
| Upload | ≥ **10 Mbps** sustained (1080p video plus data, with headroom) |
| Round-trip time | ≤ **150 ms** to the PreFlop region |
| Jitter | ≤ **30 ms** |
| Packet loss | ≤ **1%** |
| Video delay, camera → viewer | ≤ **3 s** |
| Backup link (4G/5G or a second ISP) | Required, with automatic failover |

**Live monitoring.** The table device sends a heartbeat and link stats every second. The video player reports its measured delay.

| Status | Condition | Action |
|---|---|---|
| **Healthy** | All limits met | Rounds open normally |
| **Degraded** | Any soft limit exceeded (slow upload, high RTT, jitter or loss, video delay > 3 s, backup line down) | **No new round opens**; the round in progress may finish. Players see "table reconnecting" |
| **Down** | No heartbeat for > 5 s, or video delay > 6 s | **PAUSE at once.** A round that can't be verified becomes VOID and is refunded |

Video delay never moves the betting cutoff: that is always the dealer's Start hand signal, stamped by the server (`docs/01` §4). Monitoring keeps the delay small so that players watch the hand they are betting on as it happens.

## 4. Certification checklist (back office)

`shufflerPaired` · `connectionTestPassed` · `camerasApproved` · `dealersTrained` · `shufflerSealsVerifiedThisShift` · `boardCameraCalibrated` · `tableBoxAttested` · `upsOk`

The full hardware and security setup is in [`12-table-hardware-and-security.md`](./12-table-hardware-and-security.md).

`canOpenRound()` refuses to open a round while any item is missing or the link is not healthy. Certification is reviewed every 6 months and after any equipment change.
