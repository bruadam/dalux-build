import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import * as fileAreaIndex from '../src/tools/fileAreaIndex';
import { indexIdFor, normalizeExtensions, resolveScope } from '../src/rag/scope';
import { MANIFEST_VERSION, readManifest, summarizeSkips } from '../src/rag/store';
import { ragIndexDir } from '../src/cachePaths';
import { paragraph, writeDocx, writeXlsx } from './fixtures/office';

interface FakeFile {
  fileId: string;
  fileName: string;
  folderId?: string | null;
  fileType?: string | null;
  contentHash?: string;
  source?: string;
  deleted?: boolean;
}

function fakeClient(files: FakeFile[], folders: { folderId: string; parentFolderId?: string | null }[] = []) {
  const downloadFileFromLink = jest.fn(async (link: string, name: string, dir: string) => {
    const source = files.find((file) => file.fileId === link.replace('link:', ''))?.source;
    const target = path.join(dir, name);
    if (!source) throw new Error(`No fixture for ${link}`);
    copyFileSync(source, target);
    return target;
  });

  const client = {
    files: {
      listFiles: jest.fn(async () => ({
        items: files.map((file) => ({
          fileId: file.fileId,
          fileName: file.fileName,
          folderId: file.folderId ?? 'root',
          fileType: file.fileType ?? 'document',
          contentHash: file.contentHash ?? 'v1',
          downloadLink: `link:${file.fileId}`,
          fileSize: 1024,
          deleted: file.deleted ?? false,
        })),
        metadata: { totalRemainingItems: 0 },
      })),
      downloadFileFromLink,
      getFile: jest.fn(),
    },
    folders: {
      listFolders: jest.fn(async () => ({ items: folders, metadata: { totalRemainingItems: 0 } })),
      getFolderByPath: jest.fn(async () => ({ data: { folderId: 'sub' } })),
    },
  };
  return { client: client as unknown as DaluxClient, downloadFileFromLink };
}

describe('file-area index', () => {
  let fixtures: string;
  let cache: string;
  let originalCacheDir: string | undefined;
  let originalKey: string | undefined;
  let contract: string;
  let budget: string;

  beforeAll(() => {
    fixtures = mkdtempSync(path.join(tmpdir(), 'dalux-fixtures-'));
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-cache-'));
    // Jest's sandboxed process.env does not reach os.tmpdir(), so the cache root
    // is redirected through the server's own override instead of TMPDIR.
    originalCacheDir = process.env.DALUX_MCP_CACHE_DIR;
    process.env.DALUX_MCP_CACHE_DIR = cache;
    // Ranking must be deterministic: no key means BM25, no network.
    originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    contract = writeDocx(
      fixtures,
      'contract.docx',
      [
        paragraph('4 Fire safety', 'Heading1'),
        paragraph('All doors in escape routes shall achieve fire rating EI60 with intumescent seals.'),
      ].join(''),
    );
    budget = writeXlsx(fixtures, 'budget.xlsx', [
      { name: 'Budget', rows: [['Description', 'Qty'], ['Concrete C30/37', '120']] },
    ]);
  });

  afterAll(() => {
    if (originalCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
    else process.env.DALUX_MCP_CACHE_DIR = originalCacheDir;
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    rmSync(fixtures, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  const scopeArgs = { projectId: 'p1', fileAreaId: 'fa1' };

  it('indexes the readable files and reports what it passed over', async () => {
    const { client } = fakeClient([
      { fileId: 'f1', fileName: 'contract.docx', source: contract },
      { fileId: 'f2', fileName: 'budget.xlsx', source: budget },
      { fileId: 'f3', fileName: 'model.dwg' },
    ]);

    const report = await fileAreaIndex.buildFileAreaIndex(client, scopeArgs);

    expect(report.complete).toBe(true);
    expect(report.mode).toBe('lexical');
    expect(report.filesInScope).toBe(2);
    expect(report.filesIndexedThisPass).toBe(2);
    expect(report.totalChunks).toBeGreaterThan(0);
    expect(report.skipped).toEqual([
      { reason: 'unsupported file type (.dwg)', count: 1, examples: ['model.dwg'] },
    ]);
    expect(report.failed).toEqual([]);
  });

  it('searches across documents and cites the file and location of each passage', async () => {
    const { client } = fakeClient([
      { fileId: 'f1', fileName: 'contract.docx', source: contract },
      { fileId: 'f2', fileName: 'budget.xlsx', source: budget },
    ]);
    await fileAreaIndex.buildFileAreaIndex(client, scopeArgs);

    const result = await fileAreaIndex.searchFileArea(client, {
      ...scopeArgs,
      query: 'fire rating EI60 escape routes',
    });

    expect(result.mode).toBe('lexical');
    expect(result.filesSearched).toBe(2);
    expect(result.matches[0].fileName).toBe('contract.docx');
    expect(result.matches[0].location).toBe('§ 4 Fire safety');
    expect(result.matches[0].text).toContain('EI60');

    const spreadsheet = await fileAreaIndex.searchFileArea(client, {
      ...scopeArgs,
      query: 'concrete quantity',
    });
    expect(spreadsheet.matches[0].fileName).toBe('budget.xlsx');
    expect(spreadsheet.matches[0].location).toBe('Budget!rows 2–2');
  });

  it('re-downloads only the files whose revision changed', async () => {
    const files: FakeFile[] = [
      { fileId: 'f1', fileName: 'contract.docx', source: contract },
      { fileId: 'f2', fileName: 'budget.xlsx', source: budget },
    ];
    const first = fakeClient(files);
    await fileAreaIndex.buildFileAreaIndex(first.client, scopeArgs);

    const unchanged = fakeClient(files);
    const reused = await fileAreaIndex.buildFileAreaIndex(unchanged.client, scopeArgs);
    expect(reused.filesIndexedThisPass).toBe(0);
    expect(reused.filesReused).toBe(2);
    expect(unchanged.downloadFileFromLink).not.toHaveBeenCalled();

    const revised = fakeClient([{ ...files[0], contentHash: 'v2' }, files[1]]);
    const report = await fileAreaIndex.buildFileAreaIndex(revised.client, scopeArgs);
    expect(report.filesIndexedThisPass).toBe(1);
    expect(revised.downloadFileFromLink).toHaveBeenCalledTimes(1);
  });

  it('drops documents that left the file area', async () => {
    const { client: full } = fakeClient([
      { fileId: 'f1', fileName: 'contract.docx', source: contract },
      { fileId: 'f2', fileName: 'budget.xlsx', source: budget },
    ]);
    await fileAreaIndex.buildFileAreaIndex(full, scopeArgs);

    const { client: reduced } = fakeClient([{ fileId: 'f2', fileName: 'budget.xlsx', source: budget }]);
    const report = await fileAreaIndex.buildFileAreaIndex(reduced, scopeArgs);

    expect(report.filesRemoved).toBe(1);
    const result = await fileAreaIndex.searchFileArea(reduced, { ...scopeArgs, query: 'fire rating EI60' });
    expect(result.matches).toEqual([]);
    expect(result.filesSearched).toBe(1);
  });

  it('records an unreadable file once instead of retrying it forever', async () => {
    const broken = path.join(fixtures, 'broken.docx');
    copyFileSync(path.join(fixtures, 'budget.xlsx'), broken);
    // A .docx that is really a spreadsheet: unzips fine, has no word/document.xml.
    const { client } = fakeClient([{ fileId: 'f9', fileName: 'broken.docx', source: broken }]);

    const first = await fileAreaIndex.buildFileAreaIndex(client, {
      ...scopeArgs,
      fileAreaId: 'fa-broken',
    });
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0].error).toMatch(/word\/document\.xml/);
    expect(first.complete).toBe(true);

    const second = await fileAreaIndex.buildFileAreaIndex(client, {
      ...scopeArgs,
      fileAreaId: 'fa-broken',
    });
    expect(second.filesIndexedThisPass).toBe(0);
    expect(second.failed).toHaveLength(1);
  });

  it('limits how many passages one document can contribute', async () => {
    const wordy = writeDocx(
      fixtures,
      'wordy.docx',
      Array.from({ length: 120 }, (_, i) => paragraph(`Clause ${i}: the contractor shall provide scaffolding.`)).join(''),
    );
    const { client } = fakeClient([{ fileId: 'f10', fileName: 'wordy.docx', source: wordy }]);
    await fileAreaIndex.buildFileAreaIndex(client, { ...scopeArgs, fileAreaId: 'fa-wordy' });

    const capped = await fileAreaIndex.searchFileArea(client, {
      ...scopeArgs,
      fileAreaId: 'fa-wordy',
      query: 'scaffolding',
      perFileLimit: 2,
    });
    expect(capped.matches).toHaveLength(2);

    const uncapped = await fileAreaIndex.searchFileArea(client, {
      ...scopeArgs,
      fileAreaId: 'fa-wordy',
      query: 'scaffolding',
      perFileLimit: null,
    });
    expect(uncapped.matches.length).toBeGreaterThan(2);
  });

  it('lists and drops indexes without touching Dalux', async () => {
    const { client } = fakeClient([{ fileId: 'f1', fileName: 'contract.docx', source: contract }]);
    const built = await fileAreaIndex.buildFileAreaIndex(client, { ...scopeArgs, fileAreaId: 'fa-drop' });

    const listed = await fileAreaIndex.listFileAreaIndexes();
    expect(listed.indexes.some((index) => index.indexId === built.indexId)).toBe(true);

    expect(await fileAreaIndex.dropFileAreaIndex(client, { indexId: built.indexId })).toMatchObject({
      dropped: true,
    });
    expect(await fileAreaIndex.dropFileAreaIndex(client, { indexId: built.indexId })).toMatchObject({
      dropped: false,
    });
    await expect(
      fileAreaIndex.searchFileArea(client, { indexId: built.indexId, query: 'anything' }),
    ).rejects.toThrow(/build_file_area_index/);
  });

  describe('manifest', () => {
    it('groups skipped files instead of listing thousands of them', async () => {
      const many = Array.from({ length: 40 }, (_, i) => ({ fileId: `d${i}`, fileName: `sheet${i}.dwg` }));
      const { client } = fakeClient([{ fileId: 'f1', fileName: 'contract.docx', source: contract }, ...many]);

      const built = await fileAreaIndex.buildFileAreaIndex(client, { ...scopeArgs, fileAreaId: 'fa-skips' });
      const manifest = readManifest(built.indexId);

      expect(manifest?.skipped).toEqual([
        { reason: 'unsupported file type (.dwg)', count: 40, examples: many.slice(0, 5).map((f) => f.fileName) },
      ]);
      // The manifest describes the index, it is not a copy of the file area.
      expect(JSON.stringify(manifest).length).toBeLessThan(20_000);
    });

    it('keeps progress written during a pass, so an interrupted build is not lost', async () => {
      const files = Array.from({ length: 12 }, (_, i) => ({
        fileId: `m${i}`,
        fileName: `doc${i}.docx`,
        source: contract,
      }));
      const { client } = fakeClient(files);

      await fileAreaIndex.buildFileAreaIndex(client, { ...scopeArgs, fileAreaId: 'fa-flush' });

      // Flushes happen every 10 indexed files: a build killed after the 10th
      // still finds those 10 on the next pass instead of starting over.
      const indexId = indexIdFor(await resolveScope(client, { ...scopeArgs, fileAreaId: 'fa-flush' }));
      const manifest = readManifest(indexId);
      expect(Object.keys(manifest?.files ?? {})).toHaveLength(12);
    });

    it('migrates a v1 manifest rather than throwing the index away', async () => {
      const { client } = fakeClient([{ fileId: 'f1', fileName: 'contract.docx', source: contract }]);
      const built = await fileAreaIndex.buildFileAreaIndex(client, { ...scopeArgs, fileAreaId: 'fa-v1' });

      // Rewrite the manifest in the old shape: version 1, one entry per skip.
      const manifestFile = path.join(ragIndexDir(built.indexId), 'manifest.json');
      const stored = JSON.parse(readFileSync(manifestFile, 'utf-8'));
      writeFileSync(
        manifestFile,
        JSON.stringify({
          ...stored,
          version: 1,
          skipped: [{ fileId: 'x', fileName: 'old.dwg', reason: 'unsupported file type (.dwg)' }],
        }),
      );

      const migrated = readManifest(built.indexId);

      expect(migrated?.version).toBe(MANIFEST_VERSION);
      expect(migrated?.skipped).toEqual([
        { reason: 'unsupported file type (.dwg)', count: 1, examples: ['old.dwg'] },
      ]);
      // And the documents it indexed are still searchable, not re-downloaded.
      const result = await fileAreaIndex.searchFileArea(client, {
        ...scopeArgs,
        fileAreaId: 'fa-v1',
        query: 'fire rating EI60',
      });
      expect(result.matches[0].fileName).toBe('contract.docx');
    });

    it('summarizeSkips groups by reason and keeps five examples', () => {
      expect(summarizeSkips([
        { fileName: 'a.dwg', reason: 'unsupported' },
        { fileName: 'b.dwg', reason: 'unsupported' },
        { fileName: 'c.pdf', reason: 'too large' },
      ])).toEqual([
        { reason: 'unsupported', count: 2, examples: ['a.dwg', 'b.dwg'] },
        { reason: 'too large', count: 1, examples: ['c.pdf'] },
      ]);
    });
  });

  describe('scope', () => {
    it('hashes the same scope to the same index id, and different scopes apart', async () => {
      const { client } = fakeClient([]);
      const base = await resolveScope(client, scopeArgs);
      const same = await resolveScope(client, { ...scopeArgs, recursive: true });
      const folderScoped = await resolveScope(client, { ...scopeArgs, folderId: 'sub' });

      expect(indexIdFor(base)).toBe(indexIdFor(same));
      expect(indexIdFor(base)).not.toBe(indexIdFor(folderScoped));
    });

    it('rejects extensions it cannot extract rather than indexing nothing', () => {
      expect(normalizeExtensions(['PDF', '.docx'])).toEqual(['.pdf', '.docx']);
      expect(() => normalizeExtensions(['.dwg'])).toThrow(/Unsupported extension/);
    });

    it('will not take both folderId and folderPath', async () => {
      const { client } = fakeClient([]);
      await expect(
        resolveScope(client, { ...scopeArgs, folderId: 'a', folderPath: 'Files/B' }),
      ).rejects.toThrow(/not both/);
    });

    it('indexes only the chosen folder subtree when scoped to a folder', async () => {
      const { client } = fakeClient(
        [
          { fileId: 'f1', fileName: 'contract.docx', folderId: 'sub', source: contract },
          { fileId: 'f2', fileName: 'budget.xlsx', folderId: 'elsewhere', source: budget },
        ],
        [
          { folderId: 'sub', parentFolderId: 'root' },
          { folderId: 'elsewhere', parentFolderId: 'root' },
        ],
      );

      const report = await fileAreaIndex.buildFileAreaIndex(client, {
        ...scopeArgs,
        fileAreaId: 'fa-folder',
        folderId: 'sub',
      });

      expect(report.filesInScope).toBe(1);
      expect(report.filesIndexedThisPass).toBe(1);
    });
  });
});
