import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

let cacheDir: string;
jest.mock('../src/cachePaths', () => ({
  cacheDirFor: jest.fn(() => cacheDir),
}));

// pdfjs-dist's ESM-only legacy build can't be require(ESM)'d under this repo's
// CI Node version from inside Jest's sandbox (see test/extract.rasterize.test.ts,
// which covers rasterizePdfPage's own logic against the same mocks); here the
// point is testing tools/drawings.ts's wiring, so a page count and a real
// PNG-signature buffer are all these tests need back from the renderer.
let mockPageCount = 1;
const mockGetDocument = jest.fn(() => ({
  promise: Promise.resolve({
    numPages: mockPageCount,
    getPage: jest.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    })),
  }),
  destroy: jest.fn().mockResolvedValue(undefined),
}));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const mockCreateCanvas = jest.fn((width: number, height: number) => ({
  width,
  height,
  getContext: jest.fn(),
  toBuffer: jest.fn(() => PNG_SIGNATURE),
}));
jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: mockGetDocument }));
jest.mock('@napi-rs/canvas', () => ({ createCanvas: mockCreateCanvas }));

import * as drawings from '../src/tools/drawings';
import { writePdf } from './fixtures/pdf';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

function clientServing(filePath: string, fileName: string) {
  const getFile = jest.fn().mockResolvedValue({
    downloadedFilePath: filePath,
    data: { fileName },
  });
  return { client: fakeClient({ files: { getFile } }) };
}

describe('tools/drawings', () => {
  beforeAll(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-drawings-'));
  });

  afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

  it('renders a drawing page and returns it as an image field, not JSON text', async () => {
    mockPageCount = 2;
    const file = writePdf(cacheDir, 'K31_H1_E1_N003.pdf', [
      ['104 OFFICE SPACE (31 PERS) 133,13 m2'],
      ['148 STAIRCASE 25,58 m2'],
    ]);
    const { client } = clientServing(file, 'K31_H1_E1_N003.pdf');

    const result = await drawings.renderPdfPage(client, {
      projectId: 'p1',
      fileAreaId: 'fa1',
      fileId: 'f1',
    });

    expect(result).toMatchObject({
      found: true,
      rendered: true,
      fileId: 'f1',
      fileName: 'K31_H1_E1_N003.pdf',
      page: 1,
      pageCount: 2,
    });
    expect(result.image?.mimeType).toBe('image/png');
    expect(Buffer.from(result.image?.data ?? '', 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('refuses to rasterize a non-PDF but still reports where it was downloaded', async () => {
    const { client } = clientServing('/tmp/dalux-mcp/files/f2/model.ifc', 'model.ifc');

    const result = await drawings.renderPdfPage(client, {
      projectId: 'p1',
      fileAreaId: 'fa1',
      fileId: 'f2',
    });

    expect(result).toMatchObject({ found: true, rendered: false, fileId: 'f2', fileName: 'model.ifc' });
    expect(result.message).toContain('model.ifc');
    expect(result.image).toBeUndefined();
  });

  it('reports not-found when the client cannot serve the file', async () => {
    const getFile = jest.fn().mockResolvedValue('File not found');
    const client = fakeClient({ files: { getFile } });

    const result = await drawings.renderPdfPage(client, {
      projectId: 'p1',
      fileAreaId: 'fa1',
      fileId: 'missing',
    });

    expect(result).toEqual({ found: false, message: 'File not found' });
  });

  it('surfaces an out-of-range page as a message instead of throwing', async () => {
    mockPageCount = 1;
    const file = writePdf(cacheDir, 'single.pdf', [['Only page']]);
    const { client } = clientServing(file, 'single.pdf');

    const result = await drawings.renderPdfPage(client, {
      projectId: 'p1',
      fileAreaId: 'fa1',
      fileId: 'f3',
      page: 2,
    });

    expect(result).toMatchObject({ found: true, rendered: false, fileId: 'f3', page: 2 });
    expect(result.message).toMatch(/out of range/);
  });
});
