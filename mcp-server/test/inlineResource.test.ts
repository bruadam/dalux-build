import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildInlineResource, HARD_MAX_INLINE_BYTES, isRenderableImage, maxInlineBytes, mimeTypeFor } from '../src/inlineResource';

describe('inlineResource', () => {
  let dir: string;
  let originalLimit: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-inline-'));
    originalLimit = process.env.DALUX_MCP_MAX_INLINE_BYTES;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalLimit === undefined) delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
    else process.env.DALUX_MCP_MAX_INLINE_BYTES = originalLimit;
  });

  describe('mimeTypeFor', () => {
    it('maps known extensions', () => {
      expect(mimeTypeFor('spec.pdf')).toBe('application/pdf');
      expect(mimeTypeFor('takeoff.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(mimeTypeFor('photo.JPG')).toBe('image/jpeg');
    });

    it('falls back to a generic binary type for unknown extensions', () => {
      expect(mimeTypeFor('model.dwg')).toBe('image/vnd.dwg');
      expect(mimeTypeFor('archive.rvt')).toBe('application/octet-stream');
    });
  });

  describe('isRenderableImage', () => {
    it('accepts formats a vision model can actually decode', () => {
      expect(isRenderableImage('image/png')).toBe(true);
      expect(isRenderableImage('image/jpeg')).toBe(true);
    });

    it('rejects CAD formats registered under an image/* MIME type', () => {
      expect(isRenderableImage(mimeTypeFor('model.dwg'))).toBe(false);
      expect(isRenderableImage(mimeTypeFor('model.dxf'))).toBe(false);
    });

    it('rejects formats not accepted by Claude vision input (tiff, svg)', () => {
      expect(isRenderableImage(mimeTypeFor('scan.tiff'))).toBe(false);
      expect(isRenderableImage(mimeTypeFor('icon.svg'))).toBe(false);
    });
  });

  describe('maxInlineBytes', () => {
    it('defaults to 10 MiB', () => {
      delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
      expect(maxInlineBytes()).toBe(10 * 1024 * 1024);
    });

    it('honours a valid override', () => {
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '1024';
      expect(maxInlineBytes()).toBe(1024);
    });

    it('ignores a garbage override', () => {
      process.env.DALUX_MCP_MAX_INLINE_BYTES = 'not-a-number';
      expect(maxInlineBytes()).toBe(10 * 1024 * 1024);
    });

    it('honours a per-call override', () => {
      delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
      expect(maxInlineBytes(50 * 1024 * 1024)).toBe(50 * 1024 * 1024);
    });

    it('clamps a per-call override to the 500 MiB hard ceiling', () => {
      expect(maxInlineBytes(10 * 1024 * 1024 * 1024)).toBe(HARD_MAX_INLINE_BYTES);
    });

    it('clamps an env-configured default to the hard ceiling too', () => {
      process.env.DALUX_MCP_MAX_INLINE_BYTES = String(10 * 1024 * 1024 * 1024);
      expect(maxInlineBytes()).toBe(HARD_MAX_INLINE_BYTES);
    });
  });

  describe('buildInlineResource', () => {
    it('base64-encodes a file within the limit', async () => {
      const filePath = path.join(dir, 'spec.pdf');
      writeFileSync(filePath, 'hello world');

      const result = await buildInlineResource(filePath, 'spec.pdf');

      expect(result.inlined).toBe(true);
      if (!result.inlined) throw new Error('expected inlined result');
      expect(result.size).toBe(Buffer.byteLength('hello world'));
      expect(result.mimeType).toBe('application/pdf');
      expect(Buffer.from(result.data, 'base64').toString()).toBe('hello world');
    });

    it('skips inlining and explains why when the file is over the limit', async () => {
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '4';
      const filePath = path.join(dir, 'big.pdf');
      writeFileSync(filePath, 'this is more than four bytes');

      const result = await buildInlineResource(filePath, 'big.pdf');

      expect(result.inlined).toBe(false);
      if (result.inlined) throw new Error('expected non-inlined result');
      expect(result.size).toBeGreaterThan(4);
      expect(result.reason).toContain(filePath);
      expect(result.reason).toContain('4-byte inline limit');
    });

    it('accepts a per-call maxBytesOverride above the file size', async () => {
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '4';
      const filePath = path.join(dir, 'bigger.pdf');
      writeFileSync(filePath, 'this is more than four bytes');

      const result = await buildInlineResource(filePath, 'bigger.pdf', 1024);

      expect(result.inlined).toBe(true);
    });

    it('reports an error instead of throwing when the file cannot be read', async () => {
      const result = await buildInlineResource(path.join(dir, 'missing.pdf'), 'missing.pdf');

      expect(result.inlined).toBe(false);
      if (result.inlined) throw new Error('expected non-inlined result');
      expect(result.reason).toContain('Could not read');
    });
  });
});
