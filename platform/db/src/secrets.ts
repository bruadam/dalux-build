import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const AAD = Buffer.from(VERSION);
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Reads the 32-byte master key, base64-encoded (`openssl rand -base64 32`). */
export function loadEncryptionKey(value = process.env.PLATFORM_ENCRYPTION_KEY): Buffer {
  const key = value ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new Error('PLATFORM_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

function seal(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(AAD);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

function open(key: Buffer, sealed: string): Buffer {
  const bytes = Buffer.from(sealed, 'base64url');
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(bytes.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv).setAAD(AAD).setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()]);
}

/**
 * Envelope encryption: a fresh data key encrypts the secret, the master key
 * encrypts the data key. Format: `v1.<wrapped data key>.<ciphertext>`.
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const dataKey = randomBytes(32);
  return [VERSION, seal(masterKey, dataKey), seal(dataKey, Buffer.from(plaintext, 'utf8'))].join('.');
}

export function decryptSecret(value: string, masterKey: Buffer): string {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error('Unsupported secret format');
  const dataKey = open(masterKey, parts[1]);
  return open(dataKey, parts[2]).toString('utf8');
}
