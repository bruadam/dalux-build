import type { DaluxClient } from 'dalux-build-api';
import * as files from '../src/tools/files';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/files', () => {
  it('listFileAreas returns the raw items array', async () => {
    const getFileAreas = jest.fn().mockResolvedValue({ items: [{ fileAreaId: 'fa1' }] });
    const client = fakeClient({ fileAreas: { getFileAreas } });

    const result = await files.listFileAreas(client, { projectId: 'p1' });

    expect(getFileAreas).toHaveBeenCalledWith('p1', {});
    expect(result).toEqual({ items: [{ fileAreaId: 'fa1' }] });
  });

  it('listFolders returns all folders from Dalux pagination', async () => {
    const listFolders = jest
      .fn()
      .mockResolvedValueOnce({
        items: [{ folderId: 'f1' }],
        metadata: { totalRemainingItems: 1 },
        links: [{ rel: 'nextPage', href: 'https://example.invalid/folders?bookmark=b1' }],
      })
      .mockResolvedValueOnce({
        items: [{ folderId: 'f2' }],
        metadata: { totalRemainingItems: 0 },
        links: [],
      });
    const client = fakeClient({ folders: { listFolders } });

    const result = await files.listFolders(client, { projectId: 'p1', fileAreaId: 'fa1' });

    expect(listFolders).toHaveBeenNthCalledWith(1, 'p1', 'fa1', {});
    expect(listFolders).toHaveBeenNthCalledWith(2, 'p1', 'fa1', { bookmark: 'b1' });
    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('getFolderByPath forwards to FoldersApi.getFolderByPath', async () => {
    const getFolderByPath = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ folders: { getFolderByPath } });

    const result = await files.getFolderByPath(client, { projectId: 'p1', path: 'Files/A/B' });

    expect(getFolderByPath).toHaveBeenCalledWith('p1', 'Files/A/B');
    expect(result).toBeNull();
  });

  it('listFilesInFolder follows Dalux pages and filters to folder', async () => {
    const listFiles = jest
      .fn()
      .mockResolvedValueOnce({
        items: [
          { fileId: 'file1', folderId: 'fo1' },
          { fileId: 'file2', folderId: 'other' },
        ],
        metadata: { totalRemainingItems: 1 },
        links: [{ rel: 'nextPage', href: 'https://example.invalid/files?bookmark=b1' }],
      })
      .mockResolvedValueOnce({
        items: [{ fileId: 'file3', folderId: 'fo1' }],
        metadata: { totalRemainingItems: 0 },
        links: [],
      });
    const client = fakeClient({ files: { listFiles } });

    const result = await files.listFilesInFolder(client, {
      projectId: 'p1',
      fileAreaId: 'fa1',
      folderId: 'fo1',
    });

    expect(listFiles).toHaveBeenNthCalledWith(1, 'p1', 'fa1', {});
    expect(listFiles).toHaveBeenNthCalledWith(2, 'p1', 'fa1', { bookmark: 'b1' });
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('getFile forwards to FilesApi.getFile without triggering a download', async () => {
    const getFile = jest.fn().mockResolvedValue({ data: { fileId: 'f1' } });
    const client = fakeClient({ files: { getFile } });

    await files.getFile(client, { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' });

    expect(getFile).toHaveBeenCalledWith('p1', 'fa1', 'f1');
  });
});
