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

    expect(getFileAreas).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ items: [{ fileAreaId: 'fa1' }] });
  });

  it('listFolders paginates the getAllFolders result', async () => {
    const allFolders = Array.from({ length: 75 }, (_, i) => ({ folderId: `f${i}` }));
    const getAllFolders = jest.fn().mockResolvedValue(allFolders);
    const client = fakeClient({ folders: { getAllFolders } });

    const result = await files.listFolders(client, { projectId: 'p1', fileAreaId: 'fa1', limit: 10 });

    expect(getAllFolders).toHaveBeenCalledWith('p1', 'fa1');
    expect(result.items).toHaveLength(10);
    expect(result.totalCount).toBe(75);
    expect(result.truncated).toBe(true);
  });

  it('getFolderByPath forwards to FoldersApi.getFolderByPath', async () => {
    const getFolderByPath = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ folders: { getFolderByPath } });

    const result = await files.getFolderByPath(client, { projectId: 'p1', path: 'Files/A/B' });

    expect(getFolderByPath).toHaveBeenCalledWith('p1', 'Files/A/B');
    expect(result).toBeNull();
  });

  it('listFilesInFolder paginates getAllFilesInFolder', async () => {
    const allFiles = Array.from({ length: 5 }, (_, i) => ({ fileId: `file${i}` }));
    const getAllFilesInFolder = jest.fn().mockResolvedValue(allFiles);
    const client = fakeClient({ files: { getAllFilesInFolder } });

    const result = await files.listFilesInFolder(client, {
      projectId: 'p1',
      fileAreaId: 'fa1',
      folderId: 'fo1',
    });

    expect(getAllFilesInFolder).toHaveBeenCalledWith('p1', 'fa1', 'fo1');
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it('getFile forwards to FilesApi.getFile without triggering a download', async () => {
    const getFile = jest.fn().mockResolvedValue({ data: { fileId: 'f1' } });
    const client = fakeClient({ files: { getFile } });

    await files.getFile(client, { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' });

    expect(getFile).toHaveBeenCalledWith('p1', 'fa1', 'f1');
  });
});
