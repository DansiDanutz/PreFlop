/** Server problem `type` codes (docs/13 §7) → short, plain messages for the table. */
const MESSAGES: Record<string, string> = {
  invalid_procedure_step: 'That step is out of order. Wait for the screen to update, then try again.',
  invalid_round_state: 'This hand has already moved on. The screen will update.',
  duplicate_entry: 'Already recorded — or the same person tried both entries. Both entries must come from different people.',
  forbidden_role: 'Your role is not allowed to do this.',
  forbidden_table: 'This tablet credential belongs to a different table.',
  replayed_request: 'Request was refused as a replay. Try again.',
  stale_request: 'Tablet clock is wrong (more than 30 s off). Check the tablet date and time.',
  table_not_ready: 'Table is not ready (paused, stream down or certification missing).',
  credential_revoked: 'This tablet credential has been revoked. Ask the club admin.',
  unknown_credential: 'Credential not found. Check the id the club admin gave you.',
  bad_signature: 'Signature refused: the credential id does not match this tablet key.',
  unsigned_request: 'Request was not signed.',
  invalid_flop: 'Choose exactly three different cards.',
  review_expired: 'The review deadline passed. The hand was voided and refunded.',
  idempotency_mismatch: 'A retry did not match the original request. Start the action again.',
  retry_later: 'Server busy. Retry.',
  not_found: 'Not found.',
  bad_request: 'The request was refused.',
  tablet_locked: 'The tablet is locked. Unlock it with your PIN, then retry.',
  network: 'No answer from PreFlop. Check the connection, then retry.',
  timeout: 'PreFlop did not answer in time. Retry (it is safe: the action will not run twice).',
};

export function problemMessage(type: string, title?: string): string {
  if (type === 'forbidden_role' && title && /entered the flop/i.test(title)) return 'You entered this flop, so you cannot resolve its review. Another floor manager must decide.';
  if (type === 'table_not_ready' && title && title !== type) return `Table is not ready — ${title.replace(/^table is /, '')}.`;
  return MESSAGES[type] ?? (title && title !== type ? title : `Refused (${type}).`);
}

/** Problems a retry with the same Idempotency-Key may fix (no answer, or server busy). */
export const isRetryable = (type: string) => type === 'tablet_locked' || type === 'network' || type === 'timeout' || type === 'retry_later' || type === 'internal';
