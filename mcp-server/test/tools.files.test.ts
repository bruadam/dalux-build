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

  it('searchFilesByName excludes names that do not contain the query', async () => {
    const listFiles = jest.fn().mockResolvedValue({
      items: [
        { fileId: 'f1', fileName: 'Floor Plan Level 3.pdf' },
        { fileId: 'f2', fileName: 'Structural Calcs.docx' },
      ],
    });
    const client = fakeClient({ files: { listFiles } });

    const result = await files.searchFilesByName(client, { projectId: 'p1', fileAreaId: 'fa1', query: 'calcs' });

    expect(listFiles).toHaveBeenCalledWith('p1', 'fa1', {});
    expect(result.items).toEqual([{ fileId: 'f2', fileName: 'Structural Calcs.docx' }]);
  });

  it('searchFilesByName matches a case-insensitive substring anywhere in the file name', async () => {
    const listFiles = jest.fn().mockResolvedValue({
      items: [
        { fileId: 'f1', fileName: 'Floor Plan Level 3.pdf' },
        { fileId: 'f2', fileName: 'Structural Calcs.docx' },
      ],
    });
    const client = fakeClient({ files: { listFiles } });

    const result = await files.searchFilesByName(client, { projectId: 'p1', fileAreaId: 'fa1', query: 'FLOOR PLAN' });

    expect(result.items).toEqual([{ fileId: 'f1', fileName: 'Floor Plan Level 3.pdf' }]);
    expect(result.totalCount).toBe(1);
  });

  it('searchFoldersByName matches a case-insensitive substring anywhere in the folder name', async () => {
    const listFolders = jest.fn().mockResolvedValue({
      items: [
        { folderId: 'fo1', folderName: '4_Design' },
        { folderId: 'fo2', folderName: '5_Construction' },
      ],
    });
    const client = fakeClient({ folders: { listFolders } });

    const result = await files.searchFoldersByName(client, { projectId: 'p1', fileAreaId: 'fa1', query: 'design' });

    expect(listFolders).toHaveBeenCalledWith('p1', 'fa1', {});
    expect(result.items).toEqual([{ folderId: 'fo1', folderName: '4_Design' }]);
    expect(result.totalCount).toBe(1);
  });
});

describe('tools/files lean listings', () => {
  const file = {
    fileId: 'f1',
    fileName: 'Plan.pdf',
    folderId: 'fo1',
    lastModified: '2026-01-01T00:00:00Z',
    version: '2',
    fileSize: 10,
    downloadLink: 'https://example.invalid/download',
    contentHash: 'abc',
    uploadedByUserId: 'u1',
  };

  it('listFiles returns lean items by default and pages them', async () => {
    const listFiles = jest.fn().mockResolvedValue({ items: Array.from({ length: 3 }, () => file) });
    const client = fakeClient({ files: { listFiles } });

    const result = await files.listFiles(client, { projectId: 'p1', fileAreaId: 'fa1', limit: 2 });

    expect(listFiles).toHaveBeenCalledWith('p1', 'fa1', {});
    expect(result.items).toEqual([
      { fileId: 'f1', fileName: 'Plan.pdf', folderId: 'fo1', lastModified: '2026-01-01T00:00:00Z', version: '2', fileSize: 10 },
      { fileId: 'f1', fileName: 'Plan.pdf', folderId: 'fo1', lastModified: '2026-01-01T00:00:00Z', version: '2', fileSize: 10 },
    ]);
    expect(result).toMatchObject({ totalCount: 3, returnedCount: 2, truncated: true, nextOffset: 2 });
  });

  it('listFiles adds the fields asked for', async () => {
    const listFiles = jest.fn().mockResolvedValue({ items: [file] });
    const client = fakeClient({ files: { listFiles } });

    const result = await files.listFiles(client, { projectId: 'p1', fileAreaId: 'fa1', fields: ['downloadLink'] });

    expect(result.items[0]).toMatchObject({ fileId: 'f1', downloadLink: 'https://example.invalid/download' });
    expect(result.items[0]).not.toHaveProperty('contentHash');
  });
});

describe('tools/files getFolderTree', () => {
  // root > a > a1 > a1x > a1x1, root > b
  const folders = [
    { folderId: 'root', folderName: 'Files' },
    { folderId: 'a', folderName: 'A', parentFolderId: 'root' },
    { folderId: 'b', folderName: 'B', parentFolderId: 'root' },
    { folderId: 'a1', folderName: 'A1', parentFolderId: 'a' },
    { folderId: 'a1x', folderName: 'A1x', parentFolderId: 'a1' },
    { folderId: 'a1x1', folderName: 'A1x1', parentFolderId: 'a1x' },
  ];
  const client = fakeClient({ folders: { listFolders: jest.fn().mockResolvedValue({ items: folders }) } });

  it('returns an id/name tree cut at the default depth of 3, with childCount where cut', async () => {
    const result = await files.getFolderTree(client, { projectId: 'p1', fileAreaId: 'fa1' });

    expect(result).toEqual({
      totalFolders: 6,
      maxDepth: 3,
      tree: [
        {
          id: 'root',
          name: 'Files',
          children: [
            { id: 'a', name: 'A', children: [{ id: 'a1', name: 'A1', children: [{ id: 'a1x', name: 'A1x', childCount: 1 }] }] },
            { id: 'b', name: 'B' },
          ],
        },
      ],
    });
  });

  it('honours maxDepth', async () => {
    const result = await files.getFolderTree(client, { projectId: 'p1', fileAreaId: 'fa1', maxDepth: 1 });

    expect(result.tree).toEqual([
      { id: 'root', name: 'Files', children: [{ id: 'a', name: 'A', childCount: 1 }, { id: 'b', name: 'B' }] },
    ]);
  });

  it('starts at folderId to go deeper', async () => {
    const result = await files.getFolderTree(client, { projectId: 'p1', fileAreaId: 'fa1', folderId: 'a1x', maxDepth: 1 });

    expect(result.tree).toEqual([{ id: 'a1x', name: 'A1x', children: [{ id: 'a1x1', name: 'A1x1' }] }]);
  });

  it('fails clearly for an unknown folderId', async () => {
    await expect(
      files.getFolderTree(client, { projectId: 'p1', fileAreaId: 'fa1', folderId: 'nope' }),
    ).rejects.toThrow('Folder nope not found');
  });
});
