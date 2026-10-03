/**
 * Browser-safe entry (`@preflop/odds-engine/stake-split`): the arithmetic that splits a stake into
 * fees, rake and the amount at risk, and the payout of the at-risk part. Front ends quote a bet with
 * exactly the functions the API uses at placement, without pulling in the Node-only modules
 * (evidence hashing, table readiness) that the main entry exports.
 */
export { GLOBAL_RULES } from './globalRules.ts';
export { payoutMinor } from './pricing.ts';
export { platformFeeMinor } from './houses.ts';
export { type DiamondBetSplit, type DiamondRules, splitDiamondBet } from './diamonds.ts';
export type { PlayMode } from './modes.ts';
