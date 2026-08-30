import { Configuration, ConfigurationOptions } from './configuration';
import { ApiClient } from './apiClient';

import { CompaniesApi } from './api/CompaniesApi';
import { CompanyCatalogApi } from './api/CompanyCatalogApi';
import { FileAreasApi } from './api/FileAreasApi';
import { FileRevisionsApi } from './api/FileRevisionsApi';
import { FileUploadApi } from './api/FileUploadApi';
import { FilesApi } from './api/FilesApi';
import { FoldersApi } from './api/FoldersApi';
import type { FolderTreeNode } from './api/FoldersApi';
import { FormsApi } from './api/FormsApi';
import { InspectionPlansApi } from './api/InspectionPlansApi';
import { ProjectTemplatesApi } from './api/ProjectTemplatesApi';
import { ProjectsApi } from './api/ProjectsApi';
import { TasksApi } from './api/TasksApi';
import { TestPlansApi } from './api/TestPlansApi';
import { UsersApi } from './api/UsersApi';
import { VersionSetsApi } from './api/VersionSetsApi';
import { WorkPackagesApi } from './api/WorkPackagesApi';

import {
  DaluxError,
  NotFoundError,
  ApiError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  hasNextPage,
  getNextBookmark,
  paginate,
  findByField,
  findAllByField,
  validateProjectId,
  validateFileAreaId,
  validateFolderId,
  resolveFileAreaByName,
  resolveFolderIdFromNamedPath,
} from './utils';

import * as models from './models';

export interface DaluxClient {
  projects: ProjectsApi;
  companies: CompaniesApi;
  companyCatalog: CompanyCatalogApi;
  fileAreas: FileAreasApi;
  fileRevisions: FileRevisionsApi;
  fileUpload: FileUploadApi;
  files: FilesApi;
  folders: FoldersApi;
  forms: FormsApi;
  inspectionPlans: InspectionPlansApi;
  projectTemplates: ProjectTemplatesApi;
  tasks: TasksApi;
  testPlans: TestPlansApi;
  users: UsersApi;
  versionSets: VersionSetsApi;
  workPackages: WorkPackagesApi;
}

/**
 * Create a fully configured Dalux Build API client.
 *
 * @param options.baseUrl - The API base URL (falls back to DALUX_BASE_URL env var)
 * @param options.apiKey  - Your X-API-KEY (falls back to DALUX_API_KEY env var)
 */
export function createClient(options: ConfigurationOptions = {}): DaluxClient {
  const configuration = new Configuration(options);
  const apiClient = new ApiClient(configuration);

  return {
    projects: new ProjectsApi(apiClient),
    companies: new CompaniesApi(apiClient),
    companyCatalog: new CompanyCatalogApi(apiClient),
    fileAreas: new FileAreasApi(apiClient),
    fileRevisions: new FileRevisionsApi(apiClient),
    fileUpload: new FileUploadApi(apiClient),
    files: new FilesApi(apiClient),
    folders: new FoldersApi(apiClient),
    forms: new FormsApi(apiClient),
    inspectionPlans: new InspectionPlansApi(apiClient),
    projectTemplates: new ProjectTemplatesApi(apiClient),
    tasks: new TasksApi(apiClient),
    testPlans: new TestPlansApi(apiClient),
    users: new UsersApi(apiClient),
    versionSets: new VersionSetsApi(apiClient),
    workPackages: new WorkPackagesApi(apiClient),
  };
}

export {
  Configuration,
  ApiClient,
  CompaniesApi,
  CompanyCatalogApi,
  FileAreasApi,
  FileRevisionsApi,
  FileUploadApi,
  FilesApi,
  FoldersApi,
  FormsApi,
  InspectionPlansApi,
  ProjectTemplatesApi,
  ProjectsApi,
  TasksApi,
  TestPlansApi,
  UsersApi,
  VersionSetsApi,
  WorkPackagesApi,
  // Utilities
  DaluxError,
  NotFoundError,
  ApiError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  hasNextPage,
  getNextBookmark,
  paginate,
  findByField,
  findAllByField,
  validateProjectId,
  validateFileAreaId,
  validateFolderId,
  resolveFileAreaByName,
  resolveFolderIdFromNamedPath,
};
export type { ConfigurationOptions, FolderTreeNode };

// Data models (zod schemas) - both `models.FolderSchema` and top-level `FolderSchema` work
export { models };
export * from './models';
