import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

let cacheDir: string;
jest.mock('../src/cachePaths', () => ({
  cacheDirFor: jest.fn(() => cacheDir),
}));

import * as documents from '../src/tools/documents';
import { cacheDirFor } from '../src/cachePaths';
import { paragraph, writeDocx, writeXlsx } from './fixtures/office';

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

  afterAll(() => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    rmSync(cacheDir, { recursive: true, force: true });
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
