'use strict';

const Configuration = require('./configuration');
const ApiClient = require('./apiClient');

const CompaniesApi = require('./api/CompaniesApi');
const CompanyCatalogApi = require('./api/CompanyCatalogApi');
const FileAreasApi = require('./api/FileAreasApi');
const FileRevisionsApi = require('./api/FileRevisionsApi');
const FileUploadApi = require('./api/FileUploadApi');
const FilesApi = require('./api/FilesApi');
const FoldersApi = require('./api/FoldersApi');
const FormsApi = require('./api/FormsApi');
const InspectionPlansApi = require('./api/InspectionPlansApi');
const ProjectTemplatesApi = require('./api/ProjectTemplatesApi');
const ProjectsApi = require('./api/ProjectsApi');
const TasksApi = require('./api/TasksApi');
const TestPlansApi = require('./api/TestPlansApi');
const UsersApi = require('./api/UsersApi');
const VersionSetsApi = require('./api/VersionSetsApi');
const WorkPackagesApi = require('./api/WorkPackagesApi');

const {
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
} = require('./utils');

/**
 * Create a fully configured Dalux Build API client.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]  - The API base URL (falls back to DALUX_BASE_URL env var)
 * @param {string} [options.apiKey]  - Your X-API-KEY (falls back to DALUX_API_KEY env var)
 * @returns {{
 *   projects: ProjectsApi,
 *   companies: CompaniesApi,
 *   companyCatalog: CompanyCatalogApi,
 *   fileAreas: FileAreasApi,
 *   fileRevisions: FileRevisionsApi,
 *   fileUpload: FileUploadApi,
 *   files: FilesApi,
 *   folders: FoldersApi,
 *   forms: FormsApi,
 *   inspectionPlans: InspectionPlansApi,
 *   projectTemplates: ProjectTemplatesApi,
 *   tasks: TasksApi,
 *   testPlans: TestPlansApi,
 *   users: UsersApi,
 *   versionSets: VersionSetsApi,
 *   workPackages: WorkPackagesApi
 * }}
 */
function createClient({ baseUrl, apiKey } = {}) {
  const configuration = new Configuration({ baseUrl, apiKey });
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

module.exports = {
  createClient,
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



