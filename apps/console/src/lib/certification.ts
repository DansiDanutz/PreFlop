import type { CertItem } from '@preflop/client';

/** The 9 certification items from docs/11 §4, in checklist order. */
export const CERT_ITEMS: { key: string; label: string; hint: string }[] = [
  { key: 'shufflerPaired', label: 'Trusted Shuffler paired', hint: 'PreFlop-owned, lab-certified shuffler paired with the Table Box' },
  { key: 'connectionTestPassed', label: 'Connection test passed', hint: '30-min soak: ≥20 Mbps up, RTT ≤150 ms, jitter ≤30 ms, loss ≤1%, backup line' },
  { key: 'camerasApproved', label: 'Cameras approved', hint: 'Flop area visible; no hole cards or players in any feed' },
  { key: 'dealersTrained', label: 'Dealers trained', hint: 'Start hand, cut at instructed depth, flop entry' },
  { key: 'shufflerSealsVerifiedThisShift', label: 'Shuffler seals verified (this shift)', hint: 'Seal numbers entered on the per-shift checklist' },
  { key: 'boardCameraCalibrated', label: 'Board camera calibrated', hint: 'Test flops read correctly' },
  { key: 'tableBoxAttested', label: 'Table Box attested', hint: 'TPM attestation passes, clock in sync' },
  { key: 'upsOk', label: 'UPS OK', hint: 'Charged and on mains power' },
  { key: 'privacyMasksVerified', label: 'Privacy masks verified', hint: 'People in every seat; nobody visible in any streamed feed' },
];

export const isExpired = (c: CertItem | undefined, now = Date.now()) => !!c?.expires_at && new Date(c.expires_at).getTime() <= now;
export const expiresSoon = (c: CertItem | undefined, days = 14, now = Date.now()) =>
  !!c?.expires_at && !isExpired(c, now) && new Date(c.expires_at).getTime() - now < days * 86_400_000;

/** How many of the 9 items are OK and not expired. */
export function certSummary(cert: Record<string, CertItem> | null | undefined, now = Date.now()) {
  const ok = CERT_ITEMS.filter((i) => cert?.[i.key]?.ok && !isExpired(cert[i.key], now)).length;
  const soon = CERT_ITEMS.filter((i) => cert?.[i.key]?.ok && expiresSoon(cert[i.key], 14, now)).length;
  return { ok, total: CERT_ITEMS.length, soon, complete: ok === CERT_ITEMS.length };
}
