import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  _resetDownloadLinksForTests,
  configurePublicDownloadBase,
  createDownloadLink,
  handleDownloadRequest,
} from '../src/downloadLinks';

describe('downloadLinks', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-links-'));
  });

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true });
    await _resetDownloadLinksForTests();
  });

  it('serves the file once and 404s on a second fetch (single-use)', async () => {
    const filePath = path.join(dir, 'spec.pdf');
    writeFileSync(filePath, 'pdf bytes');

    const url = await createDownloadLink(filePath, 'spec.pdf');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/download\/[a-f0-9]{48}\/spec\.pdf$/);

    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/pdf');
    expect(first.headers.get('content-disposition')).toContain('spec.pdf');
    expect(await first.text()).toBe('pdf bytes');

    const second = await fetch(url);
    expect(second.status).toBe(404);
  });

  it('404s for an unknown token', async () => {
    const port = new URL(await createDownloadLink(path.join(dir, 'x.pdf'), 'x.pdf')).port;
    const response = await fetch(`http://127.0.0.1:${port}/download/${'0'.repeat(48)}/x.pdf`);
    expect(response.status).toBe(404);
  });

  it('reuses the same server (and port) across multiple links', async () => {
    const fileA = path.join(dir, 'a.pdf');
    const fileB = path.join(dir, 'b.pdf');
    writeFileSync(fileA, 'a');
    writeFileSync(fileB, 'b');

    const urlA = await createDownloadLink(fileA, 'a.pdf');
    const urlB = await createDownloadLink(fileB, 'b.pdf');

    expect(new URL(urlA).port).toBe(new URL(urlB).port);
  });

  it('sets the Content-Type from the file extension', async () => {
    const filePath = path.join(dir, 'model.dwg');
    writeFileSync(filePath, 'cad bytes');

    const url = await createDownloadLink(filePath, 'model.dwg');
    const response = await fetch(url);

    expect(response.headers.get('content-type')).toBe('image/vnd.dwg');
  });
});

describe('downloadLinks (public mode)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-links-pub-'));
  });

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true });
    await _resetDownloadLinksForTests();
  });

  it('emits PUBLIC_URL links served by handleDownloadRequest, single-use, HEAD not consuming', async () => {
    const filePath = path.join(dir, 'LLYN B250.pdf');
    writeFileSync(filePath, 'pdf bytes');
    configurePublicDownloadBase('https://mcp.example.com/');

    const url = await createDownloadLink(filePath, 'LLYN B250.pdf');
    expect(url).toMatch(/^https:\/\/mcp\.example\.com\/download\/[a-f0-9]{48}\/LLYN%20B250\.pdf$/);

    const head = await handleDownloadRequest(new Request(url, { method: 'HEAD' }));
    expect(head?.status).toBe(200);

    const first = await handleDownloadRequest(new Request(url));
    expect(first?.status).toBe(200);
    expect(first?.headers.get('content-type')).toBe('application/pdf');
    expect(first?.headers.get('content-disposition')).toContain('LLYN%20B250.pdf');
    expect(await first?.text()).toBe('pdf bytes');

    const second = await handleDownloadRequest(new Request(url));
    expect(second?.status).toBe(404);
  });

  it('passes through non-download paths', async () => {
    expect(await handleDownloadRequest(new Request('https://mcp.example.com/mcp'))).toBeUndefined();
  });
});
