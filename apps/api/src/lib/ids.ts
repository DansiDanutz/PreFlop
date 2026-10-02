import { randomBytes } from 'node:crypto';

/** Prefixed random id, e.g. bet_3fK9… (URL-safe, 96 bits of randomness). */
export const newId = (prefix: string): string => `${prefix}_${randomBytes(12).toString('base64url')}`;
