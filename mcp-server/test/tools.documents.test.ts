import type { DaluxClient } from 'dalux-build-api';

jest.mock('../src/pdfSearch', () => ({
  cacheDirFor: jest.fn().mockReturnValue('/tmp/dalux-mcp/files/f1'),
  extractChunks: jest.fn(),
  searchChunks: jest.fn(),
}));

import * as pdfSearch from '../src/pdfSearch';
import * as documents from '../src/tools/documents';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/documents', () => {
  afterEach(() => jest.clearAllMocks());

  describe('downloadFile', () => {
    it('requests a download to the cache dir and reports the saved path', async () => {
      const getFile = jest.fn().mockResolvedValue({
        downloadedFilePath: '/tmp/dalux-mcp/files/f1/spec.pdf',
        data: { fileName: 'spec.pdf' },
      });
      const client = fakeClient({ files: { getFile } });

      const result = await documents.downloadFile(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
      });

      expect(pdfSearch.cacheDirFor).toHaveBeenCalledWith('f1');
      expect(getFile).toHaveBeenCalledWith('p1', 'fa1', 'f1', {
        download: true,
        savePath: '/tmp/dalux-mcp/files/f1',
      });
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

  describe('searchPdfContent', () => {
    it('downloads the file, extracts chunks, and returns ranked matches', async () => {
      const getFile = jest.fn().mockResolvedValue({
        downloadedFilePath: '/tmp/dalux-mcp/files/f1/spec.pdf',
        data: { fileName: 'spec.pdf' },
      });
      const client = fakeClient({ files: { getFile } });
      (pdfSearch.extractChunks as jest.Mock).mockResolvedValue([{ page: 1, text: 'concrete mix ratio' }]);
      (pdfSearch.searchChunks as jest.Mock).mockResolvedValue([{ page: 1, text: 'concrete mix ratio', score: 0.9 }]);

      const result = await documents.searchPdfContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'f1',
        query: 'concrete mix',
      });

      expect(pdfSearch.extractChunks).toHaveBeenCalledWith('/tmp/dalux-mcp/files/f1/spec.pdf');
      expect(pdfSearch.searchChunks).toHaveBeenCalledWith(
        [{ page: 1, text: 'concrete mix ratio' }],
        'concrete mix',
        5,
      );
      expect(result).toEqual({
        fileName: 'spec.pdf',
        fileId: 'f1',
        matches: [{ page: 1, text: 'concrete mix ratio', score: 0.9 }],
      });
    });

    it('skips extraction and reports not-found when the download failed', async () => {
      const getFile = jest.fn().mockResolvedValue('File not found');
      const client = fakeClient({ files: { getFile } });

      const result = await documents.searchPdfContent(client, {
        projectId: 'p1',
        fileAreaId: 'fa1',
        fileId: 'missing',
        query: 'anything',
      });

      expect(pdfSearch.extractChunks).not.toHaveBeenCalled();
      expect(result).toEqual({ found: false, message: 'File not found' });
    });
  });
});
