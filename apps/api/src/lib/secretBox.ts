import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for small secrets the server must read back (authenticator secrets: a TOTP
 * secret cannot be hashed, the server needs it to check a code). AES-256-GCM with a random nonce
 * per value; the owner's id is bound in as associated data, so a ciphertext copied onto another
 * row does not open. The key is MFA_ENCRYPTION_KEY (32 random bytes, base64), kept outside the
 * database, so a copy of the database alone does not yield the secrets.
 *
 * Stored form: `enc:v1:<nonce>:<tag>:<ciphertext>`, each part base64url. A value without the prefix
 * is one stored before encryption was turned on and is read as it is.
 */
export const SEALED_PREFIX = 'enc:v1:';
export const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export interface SecretBox {
  /** False without a key: values are stored as they are. */
  readonly encrypts: boolean;
  isSealed(stored: string): boolean;
  seal(plain: string, owner: string): string;
  /** Throws when the value was sealed with another key, for another owner, or was altered. */
  open(stored: string, owner: string): string;
}

/** The key's bytes, or null when the text is not exactly 32 bytes of base64. */
export function decodeKey(keyBase64: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(keyBase64)) return null;
  const key = Buffer.from(keyBase64, 'base64');
  return key.length === KEY_BYTES ? key : null;
}

export function secretBox(keyBase64: string | null): SecretBox {
  const isSealed = (stored: string) => stored.startsWith(SEALED_PREFIX);
  if (keyBase64 === null) {
    return {
      encrypts: false,
      isSealed,
      seal: (plain) => plain,
      open: (stored) => {
        if (isSealed(stored)) throw new Error('an encrypted secret is stored but MFA_ENCRYPTION_KEY is not set');
        return stored;
      },
    };
  }
  const key = decodeKey(keyBase64);
  if (!key) throw new Error(`MFA_ENCRYPTION_KEY must be ${KEY_BYTES} random bytes in base64`);
  return {
    encrypts: true,
    isSealed,
    seal: (plain, owner) => {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(Buffer.from(owner, 'utf8'));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return SEALED_PREFIX + [nonce, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join(':');
    },
    open: (stored, owner) => {
      if (!isSealed(stored)) return stored;
      const [nonce, tag, body, ...rest] = stored.slice(SEALED_PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64url'));
      if (!nonce || !tag || !body || rest.length) throw new Error('malformed encrypted secret');
      const decipher = createDecipheriv('aes-256-gcm', key, nonce).setAAD(Buffer.from(owner, 'utf8')).setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}
