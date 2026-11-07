import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../src/secrets';

const key = randomBytes(32);

describe('secret encryption', () => {
  it('round-trips and uses a fresh data key per secret', () => {
    const a = encryptSecret('dalux-api-key-1234', key);
    const b = encryptSecret('dalux-api-key-1234', key);
    expect(a).toMatch(/^v1\./);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('dalux-api-key-1234');
  });

  it('rejects tampered ciphertext, a tampered data key, and the wrong master key', () => {
    const [version, wrapped, body] = encryptSecret('secret', key).split('.');
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url');
      bytes[bytes.length - 1] ^= 1;
      return bytes.toString('base64url');
    };
    expect(() => decryptSecret([version, wrapped, flip(body)].join('.'), key)).toThrow();
    expect(() => decryptSecret([version, flip(wrapped), body].join('.'), key)).toThrow();
    expect(() => decryptSecret([version, wrapped, body].join('.'), randomBytes(32))).toThrow();
    expect(() => decryptSecret(['v9', wrapped, body].join('.'), key)).toThrow('Unsupported secret format');
  });

  it('requires a 32-byte base64 master key', () => {
    expect(loadEncryptionKey(key.toString('base64')).equals(key)).toBe(true);
    expect(() => loadEncryptionKey(randomBytes(16).toString('base64'))).toThrow();
    expect(() => loadEncryptionKey('')).toThrow();
  });
});
