/**
 * Browser-safe entry point.
 *
 * Everything reachable from here runs in a browser bundle: no axios, no
 * `fs`/`path`/`readline`, no `Buffer`, no `process.env`, no `dotenv`. HTTP
 * goes through a `fetch` the CALLER supplies, which is the whole point — a
 * plugin host hands down its own fetch because that wrapper is where the
 * outbound-host allow-list, the same-origin relay for an API that sends no
 * CORS headers, redirect refusal and credential omission are enforced.
 *
 * The one deliberate omission is `FilesApi`: its bulk-download and
 * interactive-selection helpers are Node-only by nature (they stream to
 * disk and read stdin). Its pure HTTP reads are on `FilesReadApi`, exposed
 * here as `files`.
 */

import { CompaniesApi } from './api/CompaniesApi';
import { CompanyCatalogApi } from './api/CompanyCatalogApi';
import { FileAreasApi } from './api/FileAreasApi';
import { FileRevisionsApi } from './api/FileRevisionsApi';
import { FilesReadApi } from './api/FilesReadApi';
import { FoldersApi } from './api/FoldersApi';
import { FormsApi } from './api/FormsApi';
import { InspectionPlansApi } from './api/InspectionPlansApi';
import { ProjectTemplatesApi } from './api/ProjectTemplatesApi';
import { ProjectsApi } from './api/ProjectsApi';
import { TasksApi } from './api/TasksApi';
import { TestPlansApi } from './api/TestPlansApi';
import { UsersApi } from './api/UsersApi';
import { VersionSetsApi } from './api/VersionSetsApi';
import { WorkPackagesApi } from './api/WorkPackagesApi';

import { TransportHttpClient, type DaluxHttpClient } from './http/client';
import { createFetchTransport, type FetchTransportOptions } from './http/fetch-transport';
import type { DaluxBinaryResponse, DaluxRequestConfig, DaluxTransport } from './http/transport';

export type {
  DaluxBinaryResponse,
  DaluxHttpClient,
  DaluxRequestConfig,
  DaluxTransport,
  FetchTransportOptions,
};
export { TransportHttpClient, createFetchTransport };
export { FilesReadApi } from './api/FilesReadApi';
export {
  DaluxError,
  NotFoundError,
  ApiError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
} from './utils/errors';
export { hasNextPage, getNextBookmark } from './utils/pagination';
export * as models from './models';

/** Every endpoint group reachable without Node. */
export interface DaluxWebClient {
  readonly http: DaluxHttpClient;
  readonly projects: ProjectsApi;
  readonly companies: CompaniesApi;
  readonly companyCatalog: CompanyCatalogApi;
  readonly fileAreas: FileAreasApi;
  readonly fileRevisions: FileRevisionsApi;
  /** Pure HTTP file reads. See {@link FilesReadApi} for what is not here. */
  readonly files: FilesReadApi;
  readonly folders: FoldersApi;
  readonly forms: FormsApi;
  readonly inspectionPlans: InspectionPlansApi;
  readonly projectTemplates: ProjectTemplatesApi;
  readonly tasks: TasksApi;
  readonly testPlans: TestPlansApi;
  readonly users: UsersApi;
  readonly versionSets: VersionSetsApi;
  readonly workPackages: WorkPackagesApi;
}

/** Builds the endpoint groups over any client. Exported for a custom transport. */
export function createWebClientFrom(http: DaluxHttpClient): DaluxWebClient {
  return {
    http,
    projects: new ProjectsApi(http),
    companies: new CompaniesApi(http),
    companyCatalog: new CompanyCatalogApi(http),
    fileAreas: new FileAreasApi(http),
    fileRevisions: new FileRevisionsApi(http),
    files: new FilesReadApi(http),
    folders: new FoldersApi(http),
    forms: new FormsApi(http),
    inspectionPlans: new InspectionPlansApi(http),
    projectTemplates: new ProjectTemplatesApi(http),
    tasks: new TasksApi(http),
    testPlans: new TestPlansApi(http),
    users: new UsersApi(http),
    versionSets: new VersionSetsApi(http),
    workPackages: new WorkPackagesApi(http),
  };
}

/**
 * A Dalux client over an injected `fetch`.
 *
 * ```ts
 * const dalux = createWebClient({
 *   baseUrl: 'https://node1.field.dalux.com/service/api',
 *   apiKey,
 *   fetch: ctx.fetch,                      // the host's sandboxed fetch
 *   defaultParams: { daluxNode: 'node2' }, // base-origin requests only
 * });
 * const sets = await dalux.versionSets.getVersionSets(projectId);
 * ```
 *
 * The API key is still sent as `X-API-KEY` on every request, so this belongs
 * only where the key legitimately lives — a host that keeps it server-side
 * should keep using the `/browser` RPC proxy entry instead.
 */
export function createWebClient(options: FetchTransportOptions): DaluxWebClient {
  const transport = createFetchTransport(options);
  return createWebClientFrom(
    new TransportHttpClient({ baseUrl: options.baseUrl, apiKey: options.apiKey }, transport),
  );
}
