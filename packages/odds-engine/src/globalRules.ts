/**
 * PLACEHOLDER GLOBAL RULES — the bounds PreFlop sets for every organizer,
 * club and partner. Organizers configure their rooms inside these bounds.
 * Change here, run `pnpm book`; the generated docs and tests follow.
 */
export const GLOBAL_RULES = Object.freeze({
  /** Organizer-run books (organizer is the house) must keep at least this margin over fair odds (bps). */
  organizerMinMarginBps: 300,
  /** Platform fee PreFlop charges an organizer-house per bet in money / chip modes. */
  platformFee: { turnoverBps: 150, minPerBetMinor: 2 },
  /** Organizers must keep at least this expected value per unit staked (bps) after fees, or the config is rejected. */
  organizerMinEvBps: 50,

  diamonds: {
    /** Fixed diamonds PreFlop takes from every diamond bet (the "sink"). */
    preflopFeePerBet: 1,
    /** Smallest stake allowed, so the fixed fee is at most 5% of any stake. */
    minStake: 20,
    /** Organizer rake on diamond bets, bps of stake. */
    rakeBpsMin: 0,
    rakeBpsMax: 1500,
    /** Price ladder per diamond in EUR cents by cumulative pack size (whole-volume discount). */
    priceTiers: [
      { fromDiamonds: 0, centsPerHundred: 100 },        // €1.00 per 100 diamonds
      { fromDiamonds: 100_000, centsPerHundred: 90 },
      { fromDiamonds: 1_000_000, centsPerHundred: 80 },
      { fromDiamonds: 10_000_000, centsPerHundred: 70 },
    ],
    /** Provider clubs are paid in EUR out of PreFlop's diamond revenue, keeping diamonds a closed loop. */
    providerShareOfDiamondRevenueBps: 2000,
  },

  virtualChips: {
    /** Chips per EUR when players buy chips. */
    chipsPerEuro: 100,
    /** Rake / fee bounds organizers may set in chip rooms (bps). */
    rakeBpsMin: 300,
    rakeBpsMax: 1500,
  },

  /** Pools and contests: rake bounds (bps of buy-ins / pool). */
  poolRakeBpsMin: 500,
  poolRakeBpsMax: 2000,
});
