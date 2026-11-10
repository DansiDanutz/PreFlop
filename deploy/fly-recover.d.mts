export type RecoveryPlan =
  | { action: 'none' }
  | { action: 'destroy'; ids: string[]; keepRelease: number; reason: string }
  | { action: 'manual'; reason: string };
export function planRecovery(machines: readonly unknown[]): RecoveryPlan;
