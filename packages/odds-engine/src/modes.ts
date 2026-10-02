/**
 * Play modes. Each mode is a separate currency with its own wallets and ledger
 * accounts — balances never move between modes.
 */

export type PlayMode = 'real-fiat' | 'real-crypto' | 'play' | 'virtual-chips' | 'diamonds';

/** Who pays the winnings (see houses.ts and docs/10-who-pays-the-winnings.md). */
export type HouseKind = 'preflop' | 'organizer' | 'pool';

export interface ModeRules {
  readonly mode: PlayMode;
  readonly label: string;
  /** Currency codes this mode settles in. */
  readonly currencies: readonly string[];
  /** Decimal places of the minor unit (EUR cents = 2, USDT/USDC = 6, whole chips/diamonds = 0). */
  readonly minorDigits: number;
  readonly fundedBy: string;
  /** What a currency can be bought with (empty = cannot be bought). */
  readonly purchasableWith: readonly string[];
  /** Who may transfer balances to players over the internet (beyond the player's own deposits/purchases). */
  readonly transferableBy: readonly ('club' | 'organizer')[];
  /** Player can reset their own balance to the starting amount at any time. */
  readonly playerCanReset: boolean;
  /** Can balances ever be withdrawn as money? */
  readonly cashOut: boolean;
  /** Do bets in this mode carry rake / platform fees? */
  readonly feesApply: boolean;
  /** Gaming licence needed in the territory where it is offered. */
  readonly requiresLicence: boolean;
  readonly requiresKyc: boolean;
  /** Which house models may run bets in this mode. */
  readonly houses: readonly HouseKind[];
  /** Organizers set their own rake within the global bounds (globalRules.ts). */
  readonly organizerSetsRules: boolean;
}

export const STABLECOINS = ['USDT', 'USDC'] as const;

export const MODES: Readonly<Record<PlayMode, ModeRules>> = Object.freeze({
  'real-fiat': {
    mode: 'real-fiat', label: 'Real money (fiat)', currencies: ['EUR'], minorDigits: 2,
    fundedBy: 'Player deposits (card, bank, wallet)', purchasableWith: ['EUR'], transferableBy: [], playerCanReset: false, cashOut: true, feesApply: true,
    requiresLicence: true, requiresKyc: true, houses: ['preflop', 'organizer', 'pool'], organizerSetsRules: false,
  },
  'real-crypto': {
    mode: 'real-crypto', label: 'Real money (stablecoins)', currencies: [...STABLECOINS], minorDigits: 6,
    fundedBy: 'Player on-chain deposits (USDT / USDC)', purchasableWith: [...STABLECOINS], transferableBy: [], playerCanReset: false, cashOut: true, feesApply: true,
    requiresLicence: true, requiresKyc: true, houses: ['preflop', 'organizer', 'pool'], organizerSetsRules: false,
  },
  play: {
    mode: 'play', label: 'Play money (fun only)', currencies: ['PLAY'], minorDigits: 0,
    fundedBy: 'Free — the player resets the balance at any time', purchasableWith: [], transferableBy: [], playerCanReset: true, cashOut: false, feesApply: false,
    requiresLicence: false, requiresKyc: false, houses: ['preflop', 'pool'], organizerSetsRules: false,
  },
  'virtual-chips': {
    mode: 'virtual-chips', label: 'Virtual chips', currencies: ['CHIP'], minorDigits: 0,
    fundedBy: 'Bought from PreFlop, or given to players by poker clubs and organizers via online transfer', purchasableWith: ['EUR', ...STABLECOINS], transferableBy: ['club', 'organizer'], playerCanReset: false, cashOut: false, feesApply: true,
    requiresLicence: false, requiresKyc: false, houses: ['preflop', 'organizer', 'pool'], organizerSetsRules: true,
  },
  diamonds: {
    mode: 'diamonds', label: 'Diamonds', currencies: ['DIAMOND'], minorDigits: 0,
    fundedBy: 'Bought by organizers from PreFlop (fiat or crypto) and transferred to their players', purchasableWith: ['EUR', ...STABLECOINS], transferableBy: ['club', 'organizer'], playerCanReset: false, cashOut: false, feesApply: true,
    requiresLicence: false, requiresKyc: false, houses: ['organizer', 'pool'], organizerSetsRules: true,
  },
});

export function assertHouseAllowed(mode: PlayMode, house: HouseKind): void {
  if (!MODES[mode].houses.includes(house)) throw new RangeError(`house '${house}' is not allowed in mode '${mode}'`);
}
