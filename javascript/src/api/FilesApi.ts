import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import axios from 'axios';
import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { findByField } from '../utils/search';
import { resolveFolderIdFromNamedPath, ResolvedFolderPath } from '../utils/pathResolver';
import { validateProjectId, validateFileAreaId, validateFolderId } from '../utils/validation';
import { convertToModel, convertToModelList } from '../models/convert';
import { FileSchema, FileResponseSchema, FilesListResponseSchema } from '../models/files';

type FileData = z.infer<typeof FileSchema>;

/**
 * Some call sites defensively unwrap a `{ data: FileData }` wrapper before
 * reading fields (matching the original JS's dynamic duck-typing across both
 * wrapped and bare item shapes). `getAllFiles`/`getFile` already return flat,
 * unwrapped items, so `.data` is normally absent here, but the shape is kept
 * for parity with the original loosely-typed JS.
 */
type MaybeWrappedFile = FileData & { data?: FileData };

/** Unwraps a possible `{ data: FileData }` wrapper into a loosely-typed record,
 * mirroring the original `f.data || f` idiom (also tolerates ad hoc / legacy
 * fields like `file_name` or `id` that aren't part of the FileSchema). */
function unwrapFile(f: MaybeWrappedFile): Record<string, unknown> {
  return (f.data || f) as unknown as Record<string, unknown>;
}

type FileWithDownload = FileData & { downloadedFilePath?: string };
type FileResponseWithDownload = z.infer<typeof FileResponseSchema> & { downloadedFilePath?: string };

interface FilesPageResponse {
  items?: unknown[];
  metadata?: { totalRemainingItems?: number | null };
  links?: { rel: string; href: string }[];
}

interface FileTreeNode {
  id: string | null;
  name: string;
  path: string;
  raw: unknown;
  children: FileTreeNode[];
  files: MaybeWrappedFile[];
}

/** Minimal shape FilesApi needs from a FoldersApi instance (still plain JS). */
interface FoldersApiLike {
  getFileAreaTree(projectId: string, fileAreaId: string, filesApi: unknown): Promise<FileTreeNode>;
}

interface GetFileOptions {
  download?: boolean;
  savePath?: string;
  verbose?: boolean;
  params?: Record<string, unknown>;
}

interface FileNameFilterOptions {
  contains?: string[] | null;
  containsMatch?: string;
  notContains?: string[] | null;
  startsWith?: string[] | null;
  notStartsWith?: string[] | null;
  endsWith?: string[] | null;
  notEndsWith?: string[] | null;
  extensions?: string[] | null;
  notExtensions?: string[] | null;
  verbose?: boolean;
}

interface BulkDownloadFolderOptions extends FileNameFilterOptions {
  params?: Record<string, unknown>;
  filenameKeywords?: string[];
  filenameKeywordsMatch?: string;
  filenameExtensions?: string[];
}

interface BulkDownloadFilesOptions {
  params?: Record<string, unknown>;
  verbose?: boolean;
}

interface BulkDownloadByIdsOptions {
  verbose?: boolean;
}

type DownloadResult = { fileName: string; downloadedFilePath: string };

/**
 * API methods for files within a file area.
 */
export class FilesApi {
  private readonly _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all files on the given project and file area.
   * GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files
   * params - Optional documented params such as includeProperties. The files endpoint does not support OData $filter.
   */
  async listFiles(
    projectId: string,
    fileAreaId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof FilesListResponseSchema>> {
    const response = await this._client.get(
      `/6.1/projects/${projectId}/file_areas/${fileAreaId}/files`,
      params,
    );
    return convertToModel(
      response,
      FilesListResponseSchema,
      'FilesListResponse',
    ) as z.infer<typeof FilesListResponseSchema>;
  }

  /**
   * Retrieve all files by following bookmark pagination (metadata.totalRemainingItems).
   */
  async getAllFiles(
    projectId: string,
    fileAreaId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<FileData[]> {
    validateProjectId(projectId);
    validateFileAreaId(fileAreaId);
    const allItems: unknown[] = [];
    let currentParams: Record<string, unknown> = { ...params };
    let hasNextPage = true;
    const urlPath = `/6.1/projects/${projectId}/file_areas/${fileAreaId}/files`;

    while (hasNextPage) {
      const response = await this._client.get<FilesPageResponse>(urlPath, currentParams);
      const items = response && response.items;
      if (items && items.length) {
        allItems.push(...items);
      }
      const remaining = ((response && response.metadata) || {}).totalRemainingItems ?? 0;
      if (verbose) {
        console.log(`Retrieved ${allItems.length} files so far, ${remaining} remaining...`);
      }
      if (!items || !items.length || remaining === 0) {
        hasNextPage = false;
      } else {
        const nextLink = (response.links || []).find((l) => l.rel === 'nextPage');
        if (nextLink) {
          const bookmark = new URL(nextLink.href).searchParams.get('bookmark');
          currentParams = { ...params, bookmark };
        } else {
          hasNextPage = false;
        }
      }
    }
    if (verbose) {
      console.log(`Done. Total files retrieved: ${allItems.length}`);
    }
    return convertToModelList(allItems, FileSchema, 'File');
  }

  /**
   * All files in a folder.
   *
   * Supports two call styles matching the Python client:
   * - `getAllFilesInFolder(projectId, fileAreaId, folderId, params?, verbose?)` — explicit IDs
   * - `getAllFilesInFolder(projectId, fileAreaIdOrPath, null, params?, verbose?)` — full path
   *   (e.g. ``"Files/4_Design/C07_Geometry"``)
   *
   * fileAreaIdOrPath - File area ID, OR a full path starting with the file area name.
   * folderId - Folder ID. When null, fileAreaIdOrPath is treated as a path.
   */
  async getAllFilesInFolder(
    projectId: string,
    fileAreaIdOrPath: string,
    folderId: string | null = null,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<FileData[]> {
    validateProjectId(projectId);

    let fileAreaId: string;
    let resolvedFolderId: string;

    if (folderId == null) {
      const resolved = await resolveFolderIdFromNamedPath(
        this._client, projectId, fileAreaIdOrPath, { verbose },
      );
      if (!resolved.fileAreaId || !resolved.folderId) {
        if (verbose) console.log(`Could not resolve folder path: ${fileAreaIdOrPath}`);
        return [];
      }
      fileAreaId = resolved.fileAreaId;
      resolvedFolderId = resolved.folderId;
    } else {
      fileAreaId = fileAreaIdOrPath;
      resolvedFolderId = folderId;
      validateFileAreaId(fileAreaId);
      validateFolderId(resolvedFolderId);
    }

    const allFiles = await this.getAllFiles(projectId, fileAreaId, params, verbose);
    const filtered = allFiles.filter((f) => {
      const data = unwrapFile(f);
      return data.folderId === resolvedFolderId;
    });
    if (verbose) {
      console.log(`Files matching folder '${resolvedFolderId}': ${filtered.length}`);
    }
    return filtered;
  }

  /**
   * Download a file from a direct download URL using X-API-KEY (same as Python client).
   * savePath - Directory to save into (default: current working directory)
   * @returns Absolute path to saved file
   */
  async downloadFileFromLink(downloadLink: string, fileName: string, savePath?: string): Promise<string> {
    const apiKey = this._client.configuration.apiKey;
    const dir = savePath || '.';
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);

    const response = await axios.get(downloadLink, {
      headers: { 'X-API-KEY': apiKey },
      responseType: 'stream',
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      throw new Error(`Failed to download file. Status code: ${response.status}`);
    }
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(filePath);
      response.data.pipe(ws);
      response.data.on('error', reject);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
    });
    return path.resolve(filePath);
  }

  /**
   * Fetch a file's raw bytes from a direct download URL using X-API-KEY, without
   * writing to disk. Useful when the caller needs to relay the content onward
   * (e.g. as an HTTP response body) rather than save it to a local filesystem.
   */
  async downloadFileBuffer(downloadLink: string): Promise<{ buffer: Buffer; contentType: string | undefined }> {
    const apiKey = this._client.configuration.apiKey;
    const response = await axios.get(downloadLink, {
      headers: { 'X-API-KEY': apiKey },
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      throw new Error(`Failed to download file. Status code: ${response.status}`);
    }
    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers['content-type'] as string | undefined,
    };
  }

  /**
   * Get a file by IDs or by full path.
   *
   * Supports two call styles matching the Python client:
   * - `getFile(projectId, fileAreaId, fileId, options?)` — explicit IDs
   * - `getFile(projectId, fullPath, null, options?)` — full path including file name
   *   (e.g. ``"Files/folder/.../file.ifc"``)
   *
   * fileAreaIdOrPath - File area ID, OR a full path.
   * fileId - File ID. When null, fileAreaIdOrPath is treated as a path.
   */
  async getFile(
    projectId: string,
    fileAreaIdOrPath: string,
    fileId: string | null = null,
    options: GetFileOptions = {},
  ): Promise<string | FileWithDownload | FileResponseWithDownload | null> {
    validateProjectId(projectId);

    if (fileId == null) {
      // Path-based lookup
      const { download = false, savePath, verbose = false, params } = options;
      const pathStr = fileAreaIdOrPath;
      const notFound = `File does not exist: ${pathStr}`;
      const parts = pathStr.split('/').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) {
        throw new Error('path must include file area name, folder path, and file name');
      }
      const resolved = await resolveFolderIdFromNamedPath(
        this._client, projectId, parts.slice(0, -1).join('/'), { verbose },
      );
      if (!resolved.fileAreaId || !resolved.folderId) return notFound;
      const files = await this.getAllFilesInFolder(
        projectId, resolved.fileAreaId, resolved.folderId, params, verbose,
      );
      const candidateFileName = parts[parts.length - 1];
      const fileMatch = findByField(files, 'fileName', candidateFileName, unwrapFile)
        || findByField(files, 'file_name', candidateFileName, unwrapFile);
      if (!fileMatch) return notFound;

      if (download) {
        const data = unwrapFile(fileMatch);
        const downloadLink = data.downloadLink as string | undefined;
        if (downloadLink) {
          const name = (data.fileName as string | undefined) || (data.file_name as string | undefined) || candidateFileName;
          const downloadedFilePath = await this.downloadFileFromLink(downloadLink, name, savePath);
          return { ...fileMatch, downloadedFilePath };
        }
      }
      return fileMatch;
    }

    // ID-based lookup (original behaviour)
    const rawResponse = await this._client.get(
      `/5.0/projects/${projectId}/file_areas/${fileAreaIdOrPath}/files/${fileId}`,
    );
    const fileInfo = convertToModel(rawResponse, FileResponseSchema, 'FileResponse') as FileResponseWithDownload | null;
    if (options.download && fileInfo && fileInfo.data && fileInfo.data.downloadLink) {
      const name = fileInfo.data.fileName || fileId;
      const downloadedPath = await this.downloadFileFromLink(
        fileInfo.data.downloadLink,
        name,
        options.savePath,
      );
      fileInfo.downloadedFilePath = downloadedPath;
    }
    return fileInfo;
  }

  /**
   * Apply file name filters (contains, startsWith, endsWith, extensions).
   */
  _applyFileNameFilters(files: FileData[], filters: FileNameFilterOptions = {}): FileData[] {
    const {
      contains = null,
      containsMatch = 'any',
      notContains = null,
      startsWith = null,
      notStartsWith = null,
      endsWith = null,
      notEndsWith = null,
      extensions = null,
      notExtensions = null,
      verbose = false,
    } = filters;

    function getName(f: FileData): string {
      const data = unwrapFile(f);
      return String((data.fileName as string | undefined) || (data.file_name as string | undefined) || '').toLowerCase();
    }
    function norm(vals: string[] | null | undefined): string[] {
      return (vals || []).map((v) => String(v).toLowerCase()).filter(Boolean);
    }
    function normExts(vals: string[] | null | undefined): string[] {
      return (vals || []).map((v) => (v.startsWith('.') ? v : `.${v}`).toLowerCase()).filter(Boolean);
    }

    let filtered = files;

    const containsVals = norm(contains);
    if (containsVals.length) {
      const before = filtered.length;
      const matchFn = containsMatch === 'all'
        ? (name: string) => containsVals.every((v) => name.includes(v))
        : (name: string) => containsVals.some((v) => name.includes(v));
      filtered = filtered.filter((f) => matchFn(getName(f)));
      if (verbose) console.log(`Files matching contains ${JSON.stringify(containsVals)} (${containsMatch}): ${filtered.length} / ${before}`);
    }

    const notContainsVals = norm(notContains);
    if (notContainsVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => !notContainsVals.some((v) => getName(f).includes(v)));
      if (verbose) console.log(`Files excluding contains ${JSON.stringify(notContainsVals)}: ${filtered.length} / ${before}`);
    }

    const startsWithVals = norm(startsWith);
    if (startsWithVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => startsWithVals.some((v) => getName(f).startsWith(v)));
      if (verbose) console.log(`Files matching startsWith ${JSON.stringify(startsWithVals)}: ${filtered.length} / ${before}`);
    }

    const notStartsWithVals = norm(notStartsWith);
    if (notStartsWithVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => !notStartsWithVals.some((v) => getName(f).startsWith(v)));
      if (verbose) console.log(`Files excluding startsWith ${JSON.stringify(notStartsWithVals)}: ${filtered.length} / ${before}`);
    }

    const endsWithVals = norm(endsWith);
    if (endsWithVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => endsWithVals.some((v) => getName(f).endsWith(v)));
      if (verbose) console.log(`Files matching endsWith ${JSON.stringify(endsWithVals)}: ${filtered.length} / ${before}`);
    }

    const notEndsWithVals = norm(notEndsWith);
    if (notEndsWithVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => !notEndsWithVals.some((v) => getName(f).endsWith(v)));
      if (verbose) console.log(`Files excluding endsWith ${JSON.stringify(notEndsWithVals)}: ${filtered.length} / ${before}`);
    }

    const extVals = normExts(extensions);
    if (extVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => extVals.some((v) => getName(f).endsWith(v)));
      if (verbose) console.log(`Files matching extensions ${JSON.stringify(extVals)}: ${filtered.length} / ${before}`);
    }

    const notExtVals = normExts(notExtensions);
    if (notExtVals.length) {
      const before = filtered.length;
      filtered = filtered.filter((f) => !notExtVals.some((v) => getName(f).endsWith(v)));
      if (verbose) console.log(`Files excluding extensions ${JSON.stringify(notExtVals)}: ${filtered.length} / ${before}`);
    }

    return filtered;
  }

  /**
   * Download all files in a folder with optional file name filters.
   *
   * Supports two call styles matching the Python client:
   * - `bulkDownloadFolder(projectId, fileAreaId, folderId, savePath?, opts?)` — explicit IDs
   * - `bulkDownloadFolder(projectId, fullPath, null, savePath?, opts?)` — full path
   *
   * fileAreaIdOrPath - File area ID or full path starting with file area name.
   * folderId - Folder ID; when null, fileAreaIdOrPath is a full path.
   */
  async bulkDownloadFolder(
    projectId: string,
    fileAreaIdOrPath: string,
    folderId: string | null = null,
    savePath?: unknown,
    opts: BulkDownloadFolderOptions = {},
  ): Promise<DownloadResult[]> {
    if (typeof savePath === 'object' && savePath !== null && !Array.isArray(savePath)) {
      opts = savePath as BulkDownloadFolderOptions;
      savePath = undefined;
    }
    const resolvedSavePath = savePath as string | undefined;
    const { params = {}, verbose = false, ...filterOpts } = opts;

    let files = await this.getAllFilesInFolder(
      projectId, fileAreaIdOrPath, folderId, params, verbose,
    );

    // Legacy keyword/extension filter aliases for backward compatibility
    if (opts.filenameKeywords && opts.filenameKeywords.length) {
      filterOpts.contains = opts.filenameKeywords;
      filterOpts.containsMatch = opts.filenameKeywordsMatch || 'any';
    }
    if (opts.filenameExtensions && opts.filenameExtensions.length) {
      filterOpts.extensions = opts.filenameExtensions;
    }

    files = this._applyFileNameFilters(files, { ...filterOpts, verbose });

    const results: DownloadResult[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      const data = unwrapFile(f);
      const fileName = (data.fileName as string | undefined)
        || (data.file_name as string | undefined)
        || (data.fileId as string | undefined)
        || `file_${i + 1}`;
      const downloadLink = data.downloadLink as string | undefined;
      if (!downloadLink) {
        if (verbose) console.log(`  [${i + 1}/${files.length}] Skipping '${fileName}' (no downloadLink)`);
        continue;
      }
      if (verbose) console.log(`  [${i + 1}/${files.length}] Downloading '${fileName}'...`);
      const downloadedFilePath = await this.downloadFileFromLink(downloadLink, fileName, resolvedSavePath);
      results.push({ fileName, downloadedFilePath });
    }
    if (verbose) console.log(`Bulk download complete. ${results.length} file(s) downloaded.`);
    return results;
  }

  /**
   * Download a list of files by IDs or full paths.
   *
   * Matches Python's ``bulk_download_files``:
   * - When *fileAreaId* is ``null``, each item in *files* is treated as a full path
   *   (e.g. ``"Files/folder/.../file.ext"``).
   * - When *fileAreaId* is provided, items are treated as file IDs.
   *
   * files - List of file IDs or full paths.
   * fileAreaId - Required when items are file IDs; null for paths.
   */
  async bulkDownloadFiles(
    projectId: string,
    files: string[],
    fileAreaId: string | null = null,
    savePath?: unknown,
    opts: BulkDownloadFilesOptions = {},
  ): Promise<DownloadResult[]> {
    if (typeof savePath === 'object' && savePath !== null) {
      opts = savePath as BulkDownloadFilesOptions;
      savePath = undefined;
    }
    const resolvedSavePath = savePath as string | undefined;
    const { params = {}, verbose = false } = opts;

    const results: DownloadResult[] = [];
    const total = files.length;
    const fileAreasCache: Record<string, Record<string, unknown>> = {};
    const foldersCache: Record<string, Record<string, unknown>[]> = {};
    const resolvedPathsCache: Record<string, ResolvedFolderPath> = {};
    const allFilesCache: Record<string, FileData[]> = {};

    for (let i = 0; i < files.length; i += 1) {
      const item = files[i];
      let fileData: Record<string, unknown> | null = null;

      if (fileAreaId == null) {
        // Path-based: "FileArea/Folder/.../file.ext"
        const parts = item.split('/').map((p) => p.trim()).filter(Boolean);
        if (parts.length < 3) {
          if (verbose) console.log(`  [${i + 1}/${total}] Skipping '${item}' (invalid path)`);
          continue;
        }
        const { fileAreaId: resolvedFaId, folderId } = await resolveFolderIdFromNamedPath(
          this._client, projectId, parts.slice(0, -1).join('/'),
          { verbose, fileAreasCache, foldersCache, resolvedPathsCache },
        );
        if (!resolvedFaId || !folderId) {
          if (verbose) console.log(`  [${i + 1}/${total}] Skipping '${item}' (File does not exist: ${item})`);
          continue;
        }
        if (!allFilesCache[resolvedFaId]) {
          allFilesCache[resolvedFaId] = await this.getAllFiles(projectId, resolvedFaId, params, verbose);
        }
        const folderFiles = (allFilesCache[resolvedFaId] || []).filter((f) => {
          const d = unwrapFile(f);
          return d.folderId === folderId;
        });
        const candidateName = parts[parts.length - 1];
        const match = findByField(folderFiles, 'fileName', candidateName, unwrapFile)
          || findByField(folderFiles, 'file_name', candidateName, unwrapFile);
        if (!match) {
          if (verbose) console.log(`  [${i + 1}/${total}] Skipping '${item}' (File does not exist: ${item})`);
          continue;
        }
        fileData = unwrapFile(match);
      } else {
        // ID-based
        const fileInfo = await this.getFile(projectId, fileAreaId, item) as FileResponseWithDownload | null;
        if (!fileInfo || typeof fileInfo === 'string') {
          if (verbose) console.log(`  [${i + 1}/${total}] Skipping '${item}' (${fileInfo || 'not found'})`);
          continue;
        }
        fileData = (fileInfo.data || fileInfo) as unknown as Record<string, unknown>;
      }

      const fileName = (fileData.fileName as string | undefined)
        || (fileData.file_name as string | undefined)
        || (fileData.fileId as string | undefined)
        || item;
      const downloadLink = fileData.downloadLink as string | undefined;
      if (!downloadLink) {
        if (verbose) console.log(`  [${i + 1}/${total}] Skipping '${fileName}' (no downloadLink)`);
        continue;
      }
      if (verbose) console.log(`  [${i + 1}/${total}] Downloading '${fileName}'...`);
      const downloadedFilePath = await this.downloadFileFromLink(downloadLink, fileName, resolvedSavePath);
      results.push({ fileName, downloadedFilePath });
    }
    if (verbose) console.log(`Done. ${results.length}/${total} file(s) downloaded.`);
    return results;
  }

  /**
   * Download files by id (fetches metadata per id then streams from downloadLink).
   */
  async bulkDownloadByIds(
    projectId: string,
    fileAreaId: string,
    fileIds: string[],
    savePath?: unknown,
    options: BulkDownloadByIdsOptions = {},
  ): Promise<Array<{ fileId: string; fileName: string; downloadedFilePath: string }>> {
    if (typeof savePath === 'object' && savePath !== null) {
      options = savePath as BulkDownloadByIdsOptions;
      savePath = undefined;
    }
    const resolvedSavePath = savePath as string | undefined;
    const { verbose = false } = options;
    const results: Array<{ fileId: string; fileName: string; downloadedFilePath: string }> = [];
    const total = fileIds.length;
    for (let i = 0; i < fileIds.length; i += 1) {
      const fileId = fileIds[i];
      const fileInfo = await this.getFile(projectId, fileAreaId, fileId) as FileResponseWithDownload | null;
      const data = ((fileInfo && fileInfo.data) || {}) as Record<string, unknown>;
      const fileName = (data.fileName as string | undefined) || fileId;
      const downloadLink = data.downloadLink as string | undefined;
      if (!downloadLink) {
        if (verbose) {
          console.log(`  [${i + 1}/${total}] Skipping '${fileName}' (no downloadLink)`);
        }
        continue;
      }
      if (verbose) {
        console.log(`  [${i + 1}/${total}] Downloading '${fileName}'...`);
      }
      const downloadedFilePath = await this.downloadFileFromLink(downloadLink, fileName, resolvedSavePath);
      results.push({ fileId, fileName, downloadedFilePath });
    }
    if (verbose) {
      console.log(`Done. ${results.length}/${total} file(s) downloaded.`);
    }
    return results;
  }

  /**
   * Interactively browse the folder tree level-by-level and select files.
   *
   * Navigation (type into stdin):
   * - A **folder number** (single token) → enter that folder.
   * - ``b`` / ``back`` → go up one level.
   * - **File numbers / ranges** (e.g. ``1``, ``3-5``) → toggle selection.
   * - ``d`` / ``done`` → finish and return selected file IDs.
   *
   * tree - Pre-built tree from FoldersApi.getFileAreaTree. If not provided, *foldersApi* must be supplied.
   * foldersApi - FoldersApi instance to build the tree automatically.
   * @returns Ordered list of selected file IDs.
   */
  async selectFilesInteractive(
    projectId: string,
    fileAreaId: string,
    tree: FileTreeNode | null = null,
    foldersApi: FoldersApiLike | null = null,
  ): Promise<string[]> {
    if (!tree) {
      if (!foldersApi) throw new Error("Either 'tree' or 'foldersApi' must be provided.");
      tree = await foldersApi.getFileAreaTree(projectId, fileAreaId, this);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));

    function getFid(f: MaybeWrappedFile): string | null {
      const d = unwrapFile(f) || {};
      return (d.id as string | undefined) || (d.fileId as string | undefined) || null;
    }
    function getFname(f: MaybeWrappedFile): string {
      return ((unwrapFile(f) || {}).fileName as string | undefined) || '<unknown>';
    }
    function hasContent(node: FileTreeNode): boolean {
      if (node.files.length) return true;
      return node.children.some(hasContent);
    }
    function countFiles(node: FileTreeNode): number {
      return node.files.length + node.children.reduce((s, c) => s + countFiles(c), 0);
    }
    function parseTokens(raw: string, maxIdx: number): Set<number> {
      const chosen = new Set<number>();
      for (const token of raw.split(/\s+/)) {
        if (token.includes('-')) {
          const [lo, hi] = token.split('-').map(Number);
          if (!isNaN(lo) && !isNaN(hi)) {
            for (let n = lo; n <= hi; n++) chosen.add(n);
          }
        } else {
          const n = parseInt(token, 10);
          if (!isNaN(n)) chosen.add(n);
        }
      }
      return new Set([...chosen].filter((n) => n >= 1 && n <= maxIdx));
    }

    const selectedIds: string[] = [];
    const selectedSet = new Set<string>();
    const stack: FileTreeNode[] = [tree];

    try {
      while (true) {
        const node = stack[stack.length - 1];
        const folders = node.children
          .filter(hasContent)
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        const files = [...node.files].sort((a, b) =>
          getFname(a).toLowerCase().localeCompare(getFname(b).toLowerCase()),
        );

        console.log();
        const header = node.path || `[root]  ${node.name}`;
        console.log(`  ${'='.repeat(60)}`);
        console.log(`  ${header}`);
        console.log(`  ${'='.repeat(60)}`);
        const navHints: string[] = [];
        if (stack.length > 1) navHints.push('[b] back');
        navHints.push(`[d] done  (${selectedIds.length} selected)`);
        console.log(`  ${navHints.join(' | ')}`);

        if (folders.length) {
          console.log('\n  Folders:');
          folders.forEach((child, i) => {
            const total = countFiles(child);
            console.log(`    [${String(i + 1).padStart(3)}]  ${child.name}/  (${total} file(s))`);
          });
        } else {
          console.log('\n  Folders: (none)');
        }

        const fileOffset = folders.length;
        if (files.length) {
          console.log('\n  Files:');
          files.forEach((f, j) => {
            const idx = fileOffset + j + 1;
            const fid = getFid(f);
            const mark = (fid != null && selectedSet.has(fid)) ? '✓ ' : '  ';
            console.log(`    [${String(idx).padStart(3)}]  ${mark}${getFname(f)}`);
          });
        } else {
          console.log('\n  Files: (none)');
        }

        console.log();
        const raw = (await question('  > ')).trim();
        const cmd = raw.toLowerCase();

        if (cmd === 'd' || cmd === 'done') break;
        if (cmd === '') continue;
        if (cmd === 'b' || cmd === 'back') {
          if (stack.length > 1) stack.pop();
          continue;
        }

        // Single folder navigation
        const tokens = raw.split(/\s+/);
        if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
          const idx = parseInt(tokens[0], 10);
          if (idx >= 1 && idx <= folders.length) {
            stack.push(folders[idx - 1]);
            continue;
          }
        }

        // File toggles
        const chosen = parseTokens(raw, fileOffset + files.length);
        let toggled = 0;
        for (const idx of [...chosen].sort((a, b) => a - b)) {
          if (idx <= folders.length) continue;
          const fileIdx = idx - fileOffset - 1;
          if (fileIdx >= 0 && fileIdx < files.length) {
            const f = files[fileIdx];
            const fid = getFid(f);
            if (!fid) continue;
            if (selectedSet.has(fid)) {
              selectedSet.delete(fid);
              const pos = selectedIds.indexOf(fid);
              if (pos !== -1) selectedIds.splice(pos, 1);
            } else {
              selectedSet.add(fid);
              selectedIds.push(fid);
            }
            toggled++;
          }
        }
        if (toggled) console.log(`  → ${selectedIds.length} file(s) selected total.`);
      }
    } finally {
      rl.close();
    }

    console.log(`\n  Done. ${selectedIds.length} file(s) selected.`);
    return selectedIds;
  }

  /**
   * Retrieve properties mapping for a specific file.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}/properties/1.0/mappings
   */
  getFilePropertiesMapping(projectId: string, fileAreaId: string, fileId: string): Promise<unknown> {
    return this._client.get(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/files/${fileId}/properties/1.0/mappings`,
    );
  }

  /**
   * Retrieve valid property values for a specific file property mapping.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}/files/properties/1.0/mappings/{filePropertyId}/values
   */
  getFilePropertyMappingValues(projectId: string, fileAreaId: string, filePropertyId: string): Promise<unknown> {
    return this._client.get(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/files/properties/1.0/mappings/${filePropertyId}/values`,
    );
  }
}
