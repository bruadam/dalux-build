import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

let cacheDir: string;
jest.mock('../src/cachePaths', () => ({
  cacheDirFor: jest.fn(() => cacheDir),
}));

import * as documents from '../src/tools/documents';
import { cacheDirFor } from '../src/cachePaths';
import { _resetDownloadLinksForTests } from '../src/downloadLinks';
import { paragraph, writeDocx, writeXlsx } from './fixtures/office';
import { writePdf } from './fixtures/pdf';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

/** A client whose getFile "download" is the fixture already sitting in the cache dir. */
function clientServing(filePath: string, fileName: string) {
  const getFile = jest.fn().mockResolvedValue({
    downloadedFilePath: filePath,
    data: { fileName },
  });
  return { client: fakeClient({ files: { getFile } }), getFile };
}

describe('tools/documents', () => {
  let originalKey: string | undefined;

  beforeAll(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-documents-'));
    originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(async () => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    rmSync(cacheDir, { recursive: true, force: true });
    await _resetDownloadLinksForTests();
  });

  afterEach(() => jest.clearAllMocks());

  describe('downloadFile', () => {
    it('requests a download to the cache dir and reports the saved path', async () => {
      const { client, getFile } = clientServing('/tmp/dalux-mcp/files/f1/spec.pdf', 'spec.pdf');

      const result = await documents.downloadFile(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
      });

      expect(cacheDirFor).toHaveBeenCalledWith('f1');
      expect(getFile).toHaveBeenCalledWith('p1', 'fa1', 'f1', { download: true, savePath: cacheDir });
      expect(result).toEqual({
        found: true,
        filePath: '/tmp/dalux-mcp/files/f1/spec.pdf',
        fileName: 'spec.pdf',
        fileId: 'f1',
      });
    });

    it('reports not-found when the client returns a plain string message', async () => {
      const getFile = jest.fn().mockResolvedValue('File not found');
      const client = fakeClient({ files: { getFile } });

      const result = await documents.downloadFile(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'missing',
      });

      expect(result).toEqual({ found: false, message: 'File not found' });
    });
  });

  describe('downloadFileToChat', () => {
    it('streams an image back as an actual image, plus a clickable download link', async () => {
      const filePath = path.join(cacheDir, 'photo.jpg');
      writeFileSync(filePath, 'fake jpeg bytes');
      const { client } = clientServing(filePath, 'photo.jpg');

      const result = (await documents.downloadFileToChat(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
      })) as Record<string, unknown>;

      expect(result).toMatchObject({ found: true, filePath, fileName: 'photo.jpg', fileId: 'f1', size: 15 });
      expect(result.downloadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/download\/[a-f0-9]{48}\/photo\.jpg$/);
      const image = result.image as { mimeType: string; data: string };
      expect(image.mimeType).toBe('image/jpeg');
      expect(Buffer.from(image.data, 'base64').toString()).toBe('fake jpeg bytes');
    });

    it('falls back to a message (still with a download link) when an image is over the inline limit', async () => {
      const originalLimit = process.env.DALUX_MCP_MAX_INLINE_BYTES;
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '4';
      try {
        const filePath = path.join(cacheDir, 'big.jpg');
        writeFileSync(filePath, 'more than four bytes');
        const { client } = clientServing(filePath, 'big.jpg');

        const result = (await documents.downloadFileToChat(client, {
          projectId: 'p1',
          fileAreaId: 'fa1',
          fileId: 'f1',
        })) as Record<string, unknown>;

        expect(result.image).toBeUndefined();
        expect(result).toMatchObject({ found: true, filePath, fileName: 'big.jpg' });
        expect(result.downloadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
        expect(result.message).toContain('inline limit');
      } finally {
        if (originalLimit === undefined) delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
        else process.env.DALUX_MCP_MAX_INLINE_BYTES = originalLimit;
      }
    });

    it('honours a per-call maxInlineBytes above the server-wide default for images', async () => {
      const originalLimit = process.env.DALUX_MCP_MAX_INLINE_BYTES;
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '4';
      try {
        const filePath = path.join(cacheDir, 'big2.jpg');
        writeFileSync(filePath, 'more than four bytes');
        const { client } = clientServing(filePath, 'big2.jpg');

        const result = (await documents.downloadFileToChat(client, {
          projectId: 'p1',
          fileAreaId: 'fa1',
          fileId: 'f1',
          maxInlineBytes: 1024,
        })) as Record<string, unknown>;

        expect(result.image).toBeDefined();
        expect(result.message).toBeUndefined();
      } finally {
        if (originalLimit === undefined) delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
        else process.env.DALUX_MCP_MAX_INLINE_BYTES = originalLimit;
      }
    });

    it('streams a PDF back as extracted text instead of raw bytes', async () => {
      const filePath = writePdf(cacheDir, 'spec.pdf', [['Fire rating EI60 required for all shafts.']]);
      const { client } = clientServing(filePath, 'spec.pdf');

      const result = (await documents.downloadFileToChat(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
      })) as Record<string, unknown>;

      expect(result).toMatchObject({ found: true, filePath, fileName: 'spec.pdf', format: 'pdf', truncated: false });
      expect(result.image).toBeUndefined();
      expect(result.text as string).toContain('Fire rating EI60');
      expect(result.downloadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    });

    it('honours a per-call maxInlineChars for extracted text', async () => {
      const filePath = writePdf(cacheDir, 'long.pdf', [['Fire rating EI60 required for all shafts.']]);
      const { client } = clientServing(filePath, 'long.pdf');

      const result = (await documents.downloadFileToChat(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
        maxInlineChars: 5,
      })) as Record<string, unknown>;

      expect(result.truncated).toBe(true);
      expect((result.text as string).length).toBe(5);
    });

    it('falls back to a message (with a download link) for a format with no text extraction and no image', async () => {
      const filePath = path.join(cacheDir, 'model.dwg');
      writeFileSync(filePath, 'binary cad bytes');
      const { client } = clientServing(filePath, 'model.dwg');

      const result = (await documents.downloadFileToChat(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
      })) as Record<string, unknown>;

      expect(result.image).toBeUndefined();
      expect(result.text).toBeUndefined();
      expect(result.downloadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(result.message).toContain(filePath);
    });

    it('passes not-found results through unchanged', async () => {
      const getFile = jest.fn().mockResolvedValue('File not found');
      const client = fakeClient({ files: { getFile } });

      const result = await documents.downloadFileToChat(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'missing',
      });

      expect(result).toEqual({ found: false, message: 'File not found' });
    });
  });

  describe('searchFileContent', () => {
    it('searches a Word document and cites the heading the passage sits under', async () => {
      const file = writeDocx(
        cacheDir,
        'contract.docx',
        [
          paragraph('7 Retention', 'Heading1'),
          paragraph('A retention of five percent is withheld until handover.'),
        ].join(''),
      );
      const { client } = clientServing(file, 'contract.docx');

      const result = await documents.searchFileContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
        query: 'retention withheld until handover',
      });

      expect(result).toMatchObject({
        found: true,
        searchable: true,
        format: 'docx',
        ranking: 'lexical',
        fileName: 'contract.docx',
      });
      expect(result.matches?.[0]).toMatchObject({ page: null, location: '§ 7 Retention' });
      expect(result.matches?.[0].text).toContain('five percent');
    });

    it('searches a spreadsheet and cites the sheet and rows', async () => {
      const file = writeXlsx(cacheDir, 'takeoff.xlsx', [
        { name: 'Takeoff', rows: [['Item', 'Qty'], ['Insulation 200mm', '450']] },
      ]);
      const { client } = clientServing(file, 'takeoff.xlsx');

      const result = await documents.searchFileContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f2',
        query: 'insulation quantity',
      });

      expect(result.matches?.[0].location).toBe('Takeoff!rows 2–2');
      expect(result.matches?.[0].text).toContain('Item=Insulation 200mm | Qty=450');
    });

    it('honours topK', async () => {
      const file = writeDocx(
        cacheDir,
        'many.docx',
        Array.from({ length: 200 }, (_, i) => paragraph(`Clause ${i}: scaffolding shall be inspected weekly.`)).join(''),
      );
      const { client } = clientServing(file, 'many.docx');

      const result = await documents.searchFileContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f3',
        query: 'scaffolding inspected',
        topK: 2,
      });

      expect(result.matches).toHaveLength(2);
    });

    it('explains an unreadable format instead of failing the tool call', async () => {
      const { client } = clientServing(path.join(cacheDir, 'model.dwg'), 'model.dwg');

      const result = await documents.searchFileContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f4',
        query: 'anything',
      });

      expect(result).toMatchObject({ found: true, searchable: false });
      expect(result.message).toContain('.docx');
    });

    it('skips extraction and reports not-found when the download failed', async () => {
      const getFile = jest.fn().mockResolvedValue('File not found');
      const client = fakeClient({ files: { getFile } });

      const result = await documents.searchFileContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'missing',
        query: 'anything',
      });

      expect(result).toEqual({ found: false, message: 'File not found' });
    });
  });
});
