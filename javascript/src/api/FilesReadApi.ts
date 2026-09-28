import { z } from 'zod';
import type { DaluxHttpClient } from '../http/client';
import type { DaluxBinaryResponse, DaluxRequestConfig } from '../http/transport';
import { resolveFolderIdFromNamedPath } from '../utils/pathResolver';
import { validateProjectId, validateFileAreaId, validateFolderId } from '../utils/validation';
import { convertToModel, convertToModelList } from '../models/convert';
import { FileSchema, FilesListResponseSchema } from '../models/files';

export type FileData = z.infer<typeof FileSchema>;

/**
 * Some call sites defensively unwrap a `{ data: FileData }` wrapper before
 * reading fields, matching the original JS's duck-typing across both wrapped
 * and bare item shapes.
 */
export type MaybeWrappedFile = FileData & { data?: FileData };

export function unwrapFile(f: MaybeWrappedFile): Record<string, unknown> {
  return (f.data || f) as unknown as Record<string, unknown>;
}

export interface FilesPageResponse {
  items?: unknown[];
  metadata?: { totalRemainingItems?: number | null };
  links?: { rel: string; href: string }[];
}

/**
 * The file endpoints that are pure HTTP — no filesystem, no interactive
 * prompts, no axios.
 *
 * Split out of `FilesApi` so a browser (or a sandboxed plugin host) can read
 * files at all. `FilesApi` statically imports `fs`, `path`, `readline` and
 * `axios` for its bulk-download and interactive-selection helpers, and a
 * bundler pulls all four in the moment anything touches a single endpoint —
 * so listing a folder was impossible outside Node for reasons that had
 * nothing to do with listing a folder.
 *
 * `FilesApi extends FilesReadApi`, so the Node surface is unchanged.
 */
export class FilesReadApi {
  protected readonly _client: DaluxHttpClient;

  constructor(apiClient: DaluxHttpClient) {
    this._client = apiClient;
  }

  /**
   * One page of a file area's files.
   * GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files
   *
   * Returns the raw `{ items, metadata, links }` envelope, so a caller that
   * drives its own cursor (passing `bookmark` in `params` and reading
   * `links`) can page one request at a time instead of draining the area.
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

  /** Every file in a file area, following bookmark pagination to the end. */
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
   * All files in a folder, by ids or by a full path starting with the file
   * area name (`"Files/4_Design/C07_Geometry"`).
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
   * One file's metadata by id, including its `downloadLink`.
   * GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}
   *
   * The id-only lookup. `FilesApi.getFile` adds path resolution and an
   * optional save-to-disk, neither of which a browser can do.
   */
  async getFileById(
    projectId: string,
    fileAreaId: string,
    fileId: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    validateProjectId(projectId);
    validateFileAreaId(fileAreaId);
    return this._client.get(
      `/5.0/projects/${projectId}/file_areas/${fileAreaId}/files/${fileId}`,
      params,
    );
  }

  /**
   * A file's raw bytes from a `downloadLink`, without touching a filesystem.
   *
   * Goes through the client's transport, so a plugin host's fetch — and the
   * permission checks, relay and credential rules attached to it — still
   * apply. The Node-only `downloadFileBuffer` on `FilesApi` wraps this and
   * returns a `Buffer`.
   */
  downloadFileBytes(downloadLink: string, config: DaluxRequestConfig = {}): Promise<DaluxBinaryResponse> {
    return this._client.binary(downloadLink, config);
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
