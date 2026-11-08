import { validateDaluxBaseUrl } from '../src/daluxUrl';
import { createRateLimiter } from '../src/rateLimit';

describe('validateDaluxBaseUrl (SSRF guard)', () => {
  it.each([
    'https://node1.field.dalux.com/service/api',
    'https://dalux.com/service/api',
    ' https://node1.field.dalux.com/service/api\n',
  ])('accepts %j', (url) => {
    expect(validateDaluxBaseUrl(url)).toEqual({ baseUrl: url.trim() });
  });

  it.each([
    'http://node1.field.dalux.com/service/api',
    'https://dalux.com.evil.example/service/api',
    'https://evildalux.com/service/api',
    'https://evil.example#.dalux.com/service/api',
    'https://node1.field.dalux.com@evil.example/service/api',
    'https://user:pw@node1.field.dalux.com/service/api',
    'https://evil.example\\@node1.field.dalux.com/',
    'https://node1.field.dalux.com/service/api\r\nHost: evil.example',
    'https://node1.field.dalux.com/ser vice',
    'https://127.0.0.1/service/api',
    'https://[::1]/service/api',
    'https://localhost/service/api',
    'https://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('rejects %j', (url) => {
    expect(validateDaluxBaseUrl(url)).toHaveProperty('error');
  });
});

describe('createRateLimiter', () => {
  it('allows `max` requests per window and per key, then starts again', () => {
    let time = 0;
    const limiter = createRateLimiter({ login: { max: 2, windowMs: 1000 } }, () => time);
    expect([limiter.allow('login', 'a'), limiter.allow('login', 'a'), limiter.allow('login', 'a')]).toEqual([true, true, false]);
    expect(limiter.allow('login', 'b')).toBe(true);
    time = 1001;
    expect(limiter.allow('login', 'a')).toBe(true);
  });
});
