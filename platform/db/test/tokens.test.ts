import { createHash } from 'node:crypto';
import { generateApiToken, hashApiToken } from '../src/tokens';

it('hashes the full token, dxm_ prefix included, as sha256 hex', () => {
  const { token, hash, displayPrefix } = generateApiToken();
  expect(token.startsWith('dxm_')).toBe(true);
  expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
  expect(hashApiToken(token)).toBe(hash);
  expect(displayPrefix).toBe(token.slice(0, 12));
});
