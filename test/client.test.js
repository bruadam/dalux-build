'use strict';

const axios = require('axios');
const path = require('path');
const MockAdapter = require('axios-mock-adapter');
const {
  createClient,
  Configuration,
  ApiClient,
  ProjectsApi,
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
  TasksApi,
  TestPlansApi,
  UsersApi,
  VersionSetsApi,
  WorkPackagesApi,
} = require('../src/index');

const BASE_URL = 'https://api.example.com/build';
const API_KEY = 'test-api-key-123';

// ---------- Configuration ----------

describe('Configuration', () => {
  it('stores baseUrl and apiKey', () => {
    const config = new Configuration({ baseUrl: BASE_URL, apiKey: API_KEY });
    expect(config.baseUrl).toBe(BASE_URL);
    expect(config.apiKey).toBe(API_KEY);
  });

  it('strips trailing slash from baseUrl', () => {
    const config = new Configuration({ baseUrl: `${BASE_URL}/`, apiKey: API_KEY });
    expect(config.baseUrl).toBe(BASE_URL);
  });

  it('throws when baseUrl is missing', () => {
    expect(() => new Configuration({ apiKey: API_KEY })).toThrow('baseUrl is required');
  });

  it('throws when apiKey is missing', () => {
    expect(() => new Configuration({ baseUrl: BASE_URL })).toThrow('apiKey is required');
  });
});

// ---------- ApiClient ----------

describe('ApiClient', () => {
  let mock;
  let client;

  beforeEach(() => {
    const config = new Configuration({ baseUrl: BASE_URL, apiKey: API_KEY });
    client = new ApiClient(config);
    mock = new MockAdapter(client._axios);
  });

  afterEach(() => {
    mock.restore();
  });

  it('throws when configuration is missing', () => {
    expect(() => new ApiClient()).toThrow('configuration is required');
  });

  it('sends X-API-KEY header on GET', async () => {
    mock.onGet('/5.1/projects').reply((config) => {
      expect(config.headers['X-API-KEY']).toBe(API_KEY);
      return [200, { items: [] }];
    });
    await client.get('/5.1/projects');
  });

  it('sends query params on GET', async () => {
    mock.onGet('/5.1/projects').reply((config) => {
      expect(config.params).toEqual({ updatedAfter: '2024-01-01' });
      return [200, {}];
    });
    await client.get('/5.1/projects', { updatedAfter: '2024-01-01' });
  });

  it('sends body on POST', async () => {
    mock.onPost('/5.0/projects').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ name: 'My Project' });
      return [201, { id: 'proj-1' }];
    });
    const result = await client.post('/5.0/projects', { name: 'My Project' });
    expect(result).toEqual({ id: 'proj-1' });
  });

  it('sends body on PATCH', async () => {
    mock.onPatch('/5.0/projects/proj-1').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ name: 'Updated' });
      return [200, { id: 'proj-1', name: 'Updated' }];
    });
    const result = await client.patch('/5.0/projects/proj-1', { name: 'Updated' });
    expect(result).toEqual({ id: 'proj-1', name: 'Updated' });
  });

  it('performs DELETE request', async () => {
    mock.onDelete('/5.0/projects/proj-1').reply(204, null);
    const result = await client.delete('/5.0/projects/proj-1');
    expect(result).toBeNull();
  });

  it('propagates HTTP errors', async () => {
    mock.onGet('/5.0/projects/bad-id').reply(404, { message: 'Not found' });
    await expect(client.get('/5.0/projects/bad-id')).rejects.toThrow();
  });
});

// ---------- createClient ----------

describe('createClient', () => {
  it('returns an object with all API namespaces', () => {
    const dalux = createClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    expect(dalux.projects).toBeInstanceOf(ProjectsApi);
    expect(dalux.companies).toBeInstanceOf(CompaniesApi);
    expect(dalux.companyCatalog).toBeInstanceOf(CompanyCatalogApi);
    expect(dalux.fileAreas).toBeInstanceOf(FileAreasApi);
    expect(dalux.fileRevisions).toBeInstanceOf(FileRevisionsApi);
    expect(dalux.fileUpload).toBeInstanceOf(FileUploadApi);
    expect(dalux.files).toBeInstanceOf(FilesApi);
    expect(dalux.folders).toBeInstanceOf(FoldersApi);
    expect(dalux.forms).toBeInstanceOf(FormsApi);
    expect(dalux.inspectionPlans).toBeInstanceOf(InspectionPlansApi);
    expect(dalux.projectTemplates).toBeInstanceOf(ProjectTemplatesApi);
    expect(dalux.tasks).toBeInstanceOf(TasksApi);
    expect(dalux.testPlans).toBeInstanceOf(TestPlansApi);
    expect(dalux.users).toBeInstanceOf(UsersApi);
    expect(dalux.versionSets).toBeInstanceOf(VersionSetsApi);
    expect(dalux.workPackages).toBeInstanceOf(WorkPackagesApi);
  });
});

// ---------- Helper: create mock-backed dalux client ----------

function createMockedClient() {
  const config = new Configuration({ baseUrl: BASE_URL, apiKey: API_KEY });
  const apiClient = new ApiClient(config);
  const mock = new MockAdapter(apiClient._axios);
  return { apiClient, mock };
}

// ---------- ProjectsApi ----------

describe('ProjectsApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new ProjectsApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listProjects calls GET /5.1/projects', async () => {
    const data = { items: [{ id: 'p1' }] };
    mock.onGet('/5.1/projects').reply(200, data);
    expect(await api.listProjects()).toEqual(data);
  });

  it('listProjects passes query params', async () => {
    mock.onGet('/5.1/projects').reply((config) => {
      expect(config.params).toEqual({ updatedAfter: '2024-01-01' });
      return [200, {}];
    });
    await api.listProjects({ updatedAfter: '2024-01-01' });
  });

  it('getProject calls GET /5.0/projects/:id', async () => {
    const data = { id: 'p1', name: 'Test' };
    mock.onGet('/5.0/projects/p1').reply(200, data);
    expect(await api.getProject('p1')).toEqual(data);
  });

  it('createProject calls POST /5.0/projects', async () => {
    const body = { name: 'New Project' };
    mock.onPost('/5.0/projects').reply(201, { id: 'p2', ...body });
    const result = await api.createProject(body);
    expect(result.name).toBe('New Project');
  });

  it('updateProject calls PATCH /5.0/projects/:id', async () => {
    mock.onPatch('/5.0/projects/p1').reply(200, { id: 'p1', name: 'Updated' });
    const result = await api.updateProject('p1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('listMetadataMappingsForProjects calls GET /1.0/projects/metadata/1.0/mappings', async () => {
    mock.onGet('/1.0/projects/metadata/1.0/mappings').reply(200, []);
    expect(await api.listMetadataMappingsForProjects()).toEqual([]);
  });

  it('listMetadataValuesForProjects calls correct URL', async () => {
    mock.onGet('/1.0/projects/metadata/1.0/mappings/status/values').reply(200, []);
    expect(await api.listMetadataValuesForProjects('status')).toEqual([]);
  });

  it('listProjectMetadata calls correct URL', async () => {
    mock.onGet('/1.0/projects/p1/metadata').reply(200, {});
    expect(await api.listProjectMetadata('p1')).toEqual({});
  });

  it('listProjectMetadataMappings calls correct URL', async () => {
    mock.onGet('/1.0/projects/p1/metadata/1.0/mappings').reply(200, []);
    expect(await api.listProjectMetadataMappings('p1')).toEqual([]);
  });

  it('listProjectMetadataValues calls correct URL', async () => {
    mock.onGet('/1.0/projects/p1/metadata/1.0/mappings/phase/values').reply(200, []);
    expect(await api.listProjectMetadataValues('p1', 'phase')).toEqual([]);
  });
});

// ---------- CompaniesApi ----------

describe('CompaniesApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new CompaniesApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listProjectCompanies calls GET /3.1/projects/:id/companies', async () => {
    mock.onGet('/3.1/projects/p1/companies').reply(200, []);
    expect(await api.listProjectCompanies('p1')).toEqual([]);
  });

  it('getProjectCompany calls GET /3.0/projects/:id/companies/:cid', async () => {
    mock.onGet('/3.0/projects/p1/companies/c1').reply(200, { id: 'c1' });
    expect(await api.getProjectCompany('p1', 'c1')).toEqual({ id: 'c1' });
  });

  it('createProjectCompany calls POST /3.1/projects/:id/companies', async () => {
    mock.onPost('/3.1/projects/p1/companies').reply(201, { id: 'c2' });
    expect(await api.createProjectCompany('p1', {})).toEqual({ id: 'c2' });
  });

  it('updateProjectCompany calls PATCH /3.0/projects/:id/companies/:cid', async () => {
    mock.onPatch('/3.0/projects/p1/companies/c1').reply(200, { id: 'c1' });
    expect(await api.updateProjectCompany('p1', 'c1', {})).toEqual({ id: 'c1' });
  });
});

// ---------- CompanyCatalogApi ----------

describe('CompanyCatalogApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new CompanyCatalogApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getCompanies calls GET /2.2/companyCatalog', async () => {
    mock.onGet('/2.2/companyCatalog').reply(200, []);
    expect(await api.getCompanies()).toEqual([]);
  });

  it('getCompany calls GET /1.2/companyCatalog/:id', async () => {
    mock.onGet('/1.2/companyCatalog/cc1').reply(200, { id: 'cc1' });
    expect(await api.getCompany('cc1')).toEqual({ id: 'cc1' });
  });

  it('createCompany calls POST /2.2/companyCatalog', async () => {
    mock.onPost('/2.2/companyCatalog').reply(201, { id: 'cc2' });
    expect(await api.createCompany({})).toEqual({ id: 'cc2' });
  });

  it('updateCompany calls PATCH /2.1/companyCatalog/:id', async () => {
    mock.onPatch('/2.1/companyCatalog/cc1').reply(200, { id: 'cc1' });
    expect(await api.updateCompany('cc1', {})).toEqual({ id: 'cc1' });
  });

  it('listCompanyMetadata calls correct URL', async () => {
    mock.onGet('/1.0/companyCatalog/cc1/metadata').reply(200, {});
    expect(await api.listCompanyMetadata('cc1')).toEqual({});
  });

  it('listCompanyMetadataMappings calls correct URL', async () => {
    mock.onGet('/1.0/companyCatalog/cc1/metadata/1.0/mappings').reply(200, []);
    expect(await api.listCompanyMetadataMappings('cc1')).toEqual([]);
  });

  it('listCompanyMetadataValues calls correct URL', async () => {
    mock.onGet('/1.0/companyCatalog/cc1/metadata/1.0/mappings/industry/values').reply(200, []);
    expect(await api.listCompanyMetadataValues('cc1', 'industry')).toEqual([]);
  });

  it('listMetadataMappingsForCompanies calls correct URL', async () => {
    mock.onGet('/1.0/companyCatalog/metadata/1.0/mappings').reply(200, []);
    expect(await api.listMetadataMappingsForCompanies()).toEqual([]);
  });

  it('listMetadataValuesForCompanies calls correct URL', async () => {
    mock.onGet('/1.0/companyCatalog/metadata/1.0/mappings/country/values').reply(200, []);
    expect(await api.listMetadataValuesForCompanies('country')).toEqual([]);
  });
});

// ---------- TasksApi ----------

describe('TasksApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new TasksApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getProjectTasks calls GET /5.2/projects/:id/tasks', async () => {
    mock.onGet('/5.2/projects/p1/tasks').reply(200, []);
    expect(await api.getProjectTasks('p1')).toEqual([]);
  });

  it('getProjectTasks maps typeId to OData $filter', async () => {
    mock.onGet('/5.2/projects/p1/tasks', { params: { $filter: "data/type/typeId eq 't1'" } }).reply(200, { items: [] });
    await api.getProjectTasks('p1', { typeId: 't1' });
  });

  it('getProjectTasks leaves $filter unchanged and drops typeId', async () => {
    mock
      .onGet('/5.2/projects/p1/tasks', { params: { $filter: 'custom eq 1' } })
      .reply(200, { items: [] });
    await api.getProjectTasks('p1', { typeId: 'ignored', $filter: 'custom eq 1' });
  });

  it('normalizeTaskParams escapes single quotes in typeId', () => {
    expect(TasksApi.normalizeTaskParams({ typeId: "a'b" }).$filter).toBe(
      "data/type/typeId eq 'a''b'",
    );
  });

  it('getAllProjectTasks follows nextPage bookmark pagination', async () => {
    const page1 = {
      items: [{ data: { taskId: 't1' } }],
      metadata: { totalItems: 2 },
      links: [{ rel: 'nextPage', href: 'https://api.example.com/build/5.2/projects/p1/tasks?bookmark=bm1', method: 'GET' }],
    };
    const page2 = {
      items: [{ data: { taskId: 't2' } }],
      metadata: { totalItems: 2 },
      links: [],
    };
    mock.onGet('/5.2/projects/p1/tasks', { params: {} }).reply(200, page1);
    mock.onGet('/5.2/projects/p1/tasks', { params: { bookmark: 'bm1' } }).reply(200, page2);
    const all = await api.getAllProjectTasks('p1');
    expect(all).toHaveLength(2);
    expect(all[0].data.taskId).toBe('t1');
    expect(all[1].data.taskId).toBe('t2');
  });

  it('getTask calls GET /3.3/projects/:id/tasks/:taskId', async () => {
    mock.onGet('/3.3/projects/p1/tasks/t1').reply(200, { id: 't1' });
    expect(await api.getTask('p1', 't1')).toEqual({ id: 't1' });
  });

  it('getProjectTaskChanges calls GET /2.2/projects/:id/tasks/changes', async () => {
    mock.onGet('/2.2/projects/p1/tasks/changes').reply(200, []);
    expect(await api.getProjectTaskChanges('p1')).toEqual([]);
  });

  it('getProjectTaskAttachments calls GET /1.1/projects/:id/tasks/attachments', async () => {
    mock.onGet('/1.1/projects/p1/tasks/attachments').reply(200, []);
    expect(await api.getProjectTaskAttachments('p1')).toEqual([]);
  });
});

// ---------- FileAreasApi ----------

describe('FileAreasApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new FileAreasApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getFileAreas calls GET /5.1/projects/:id/file_areas', async () => {
    mock.onGet('/5.1/projects/p1/file_areas').reply(200, []);
    expect(await api.getFileAreas('p1')).toEqual([]);
  });

  it('getFileArea calls GET /1.0/projects/:id/file_areas/:faId', async () => {
    mock.onGet('/1.0/projects/p1/file_areas/fa1').reply(200, { id: 'fa1' });
    expect(await api.getFileArea('p1', 'fa1')).toEqual({ id: 'fa1' });
  });
});

// ---------- FilesApi ----------

describe('FilesApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new FilesApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listFiles calls GET /6.1/projects/:id/file_areas/:faId/files', async () => {
    mock.onGet('/6.1/projects/p1/file_areas/fa1/files').reply(200, []);
    expect(await api.listFiles('p1', 'fa1')).toEqual([]);
  });

  it('getFile calls correct URL', async () => {
    mock.onGet('/5.0/projects/p1/file_areas/fa1/files/f1').reply(200, { id: 'f1' });
    expect(await api.getFile('p1', 'fa1', 'f1')).toEqual({ id: 'f1' });
  });

  it('getAllFiles follows bookmark until totalRemainingItems is 0', async () => {
    const page1 = {
      items: [{ data: { fileId: 'a' } }],
      metadata: { totalRemainingItems: 1 },
      links: [{ rel: 'nextPage', href: `${BASE_URL}/6.1/projects/p1/file_areas/fa1/files?bookmark=b1` }],
    };
    const page2 = {
      items: [{ data: { fileId: 'b' } }],
      metadata: { totalRemainingItems: 0 },
      links: [],
    };
    mock.onGet('/6.1/projects/p1/file_areas/fa1/files', { params: {} }).reply(200, page1);
    mock.onGet('/6.1/projects/p1/file_areas/fa1/files', { params: { bookmark: 'b1' } }).reply(200, page2);
    const all = await api.getAllFiles('p1', 'fa1');
    expect(all).toHaveLength(2);
    expect(all[0].data.fileId).toBe('a');
    expect(all[1].data.fileId).toBe('b');
  });

  it('getFile with download streams to disk', async () => {
    const axiosMod = require('axios');
    const { Readable } = require('stream');
    const os = require('os');
    const fs = require('fs');

    const dlSpy = jest.spyOn(axiosMod, 'get').mockResolvedValue({
      status: 200,
      data: Readable.from([Buffer.from('hello')]),
    });
    mock.onGet('/5.0/projects/p1/file_areas/fa1/files/f1').reply(200, {
      data: { fileName: 't.bin', downloadLink: 'https://files.example/download/1' },
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dalux-dl-'));
    try {
      const out = await api.getFile('p1', 'fa1', 'f1', { download: true, savePath: tmp });
      expect(out.downloadedFilePath).toContain('t.bin');
      expect(fs.readFileSync(out.downloadedFilePath, 'utf8')).toBe('hello');
      expect(dlSpy).toHaveBeenCalledWith(
        'https://files.example/download/1',
        expect.objectContaining({
          headers: { 'X-API-KEY': API_KEY },
          responseType: 'stream',
        }),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      dlSpy.mockRestore();
    }
  });

  it('getFilePropertiesMapping calls correct URL', async () => {
    mock
      .onGet('/1.0/projects/p1/file_areas/fa1/files/f1/properties/1.0/mappings')
      .reply(200, []);
    expect(await api.getFilePropertiesMapping('p1', 'fa1', 'f1')).toEqual([]);
  });

  it('getFilePropertyMappingValues calls correct URL', async () => {
    mock
      .onGet('/1.0/projects/p1/file_areas/fa1/files/properties/1.0/mappings/prop1/values')
      .reply(200, []);
    expect(await api.getFilePropertyMappingValues('p1', 'fa1', 'prop1')).toEqual([]);
  });
});

// ---------- FoldersApi ----------

describe('FoldersApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new FoldersApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listFolders calls GET /5.1/projects/:id/file_areas/:faId/folders', async () => {
    mock.onGet('/5.1/projects/p1/file_areas/fa1/folders').reply(200, []);
    expect(await api.listFolders('p1', 'fa1')).toEqual([]);
  });

  it('getFolder calls correct URL', async () => {
    mock.onGet('/5.0/projects/p1/file_areas/fa1/folders/fo1').reply(200, { id: 'fo1' });
    expect(await api.getFolder('p1', 'fa1', 'fo1')).toEqual({ id: 'fo1' });
  });

  it('getFolderFilesProperties calls correct URL', async () => {
    mock
      .onGet(
        '/1.0/projects/p1/file_areas/fa1/folders/fo1/files/properties/1.0/mappings',
      )
      .reply(200, []);
    expect(await api.getFolderFilesProperties('p1', 'fa1', 'fo1')).toEqual([]);
  });
});

// ---------- FileUploadApi ----------

describe('FileUploadApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new FileUploadApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('createUpload calls POST /1.0/projects/:id/file_areas/:faId/upload', async () => {
    mock.onPost('/1.0/projects/p1/file_areas/fa1/upload').reply(200, { uploadGuid: 'guid-1' });
    expect(await api.createUpload('p1', 'fa1', {})).toEqual({ uploadGuid: 'guid-1' });
  });

  it('uploadFilePart calls POST with correct URL', async () => {
    mock.onPost('/1.0/projects/p1/file_areas/fa1/upload/guid-1').reply(200, {});
    expect(await api.uploadFilePart('p1', 'fa1', 'guid-1', Buffer.from('data'))).toEqual({});
  });

  it('finishUpload calls POST /2.0/.../finalize', async () => {
    mock
      .onPost('/2.0/projects/p1/file_areas/fa1/upload/guid-1/finalize')
      .reply(200, { fileId: 'f-new' });
    expect(await api.finishUpload('p1', 'fa1', 'guid-1', {})).toEqual({ fileId: 'f-new' });
  });
});

// ---------- FileRevisionsApi ----------

describe('FileRevisionsApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new FileRevisionsApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getFileRevisionContent calls correct URL', async () => {
    mock
      .onGet('/2.0/projects/p1/file_areas/fa1/files/f1/revisions/r1/content')
      .reply(200, Buffer.from('pdf-content'));
    const result = await api.getFileRevisionContent('p1', 'fa1', 'f1', 'r1');
    expect(result).toBeDefined();
  });
});

// ---------- FormsApi ----------

describe('FormsApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new FormsApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getProjectForms calls GET /2.1/projects/:id/forms', async () => {
    mock.onGet('/2.1/projects/p1/forms').reply(200, []);
    expect(await api.getProjectForms('p1')).toEqual([]);
  });

  it('getForm calls GET /1.2/projects/:id/forms/:formId', async () => {
    mock.onGet('/1.2/projects/p1/forms/fm1').reply(200, { id: 'fm1' });
    expect(await api.getForm('p1', 'fm1')).toEqual({ id: 'fm1' });
  });

  it('getProjectFormAttachments calls GET /2.1/projects/:id/forms/attachments', async () => {
    mock.onGet('/2.1/projects/p1/forms/attachments').reply(200, []);
    expect(await api.getProjectFormAttachments('p1')).toEqual([]);
  });
});

// ---------- UsersApi ----------

describe('UsersApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new UsersApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getUser calls GET /1.1/users/:id', async () => {
    mock.onGet('/1.1/users/u1').reply(200, { id: 'u1' });
    expect(await api.getUser('u1')).toEqual({ id: 'u1' });
  });

  it('listProjectUsers calls GET /1.2/projects/:id/users', async () => {
    mock.onGet('/1.2/projects/p1/users').reply(200, []);
    expect(await api.listProjectUsers('p1')).toEqual([]);
  });

  it('getProjectUser calls GET /1.1/projects/:id/users/:userId', async () => {
    mock.onGet('/1.1/projects/p1/users/u1').reply(200, { id: 'u1' });
    expect(await api.getProjectUser('p1', 'u1')).toEqual({ id: 'u1' });
  });
});

// ---------- ProjectTemplatesApi ----------

describe('ProjectTemplatesApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new ProjectTemplatesApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listProjectTemplates calls GET /1.1/projectTemplates', async () => {
    mock.onGet('/1.1/projectTemplates').reply(200, []);
    expect(await api.listProjectTemplates()).toEqual([]);
  });
});

// ---------- InspectionPlansApi ----------

describe('InspectionPlansApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new InspectionPlansApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listInspectionPlans calls GET /1.2/projects/:id/inspectionPlans', async () => {
    mock.onGet('/1.2/projects/p1/inspectionPlans').reply(200, []);
    expect(await api.listInspectionPlans('p1')).toEqual([]);
  });

  it('listInspectionPlanItems calls correct URL', async () => {
    mock.onGet('/1.1/projects/p1/inspectionPlanItems').reply(200, []);
    expect(await api.listInspectionPlanItems('p1')).toEqual([]);
  });

  it('listInspectionPlanItemZones calls correct URL', async () => {
    mock.onGet('/1.1/projects/p1/inspectionPlanItemZones').reply(200, []);
    expect(await api.listInspectionPlanItemZones('p1')).toEqual([]);
  });

  it('listInspectionPlanRegistrations calls correct URL', async () => {
    mock.onGet('/2.1/projects/p1/inspectionPlanRegistrations').reply(200, []);
    expect(await api.listInspectionPlanRegistrations('p1')).toEqual([]);
  });
});

// ---------- TestPlansApi ----------

describe('TestPlansApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new TestPlansApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listTestPlans calls GET /1.2/projects/:id/testPlans', async () => {
    mock.onGet('/1.2/projects/p1/testPlans').reply(200, []);
    expect(await api.listTestPlans('p1')).toEqual([]);
  });

  it('listTestPlanItems calls correct URL', async () => {
    mock.onGet('/1.1/projects/p1/testPlanItems').reply(200, []);
    expect(await api.listTestPlanItems('p1')).toEqual([]);
  });

  it('listTestPlanItemZones calls correct URL', async () => {
    mock.onGet('/1.1/projects/p1/testPlanItemZones').reply(200, []);
    expect(await api.listTestPlanItemZones('p1')).toEqual([]);
  });

  it('listTestPlanRegistrations calls correct URL', async () => {
    mock.onGet('/1.1/projects/p1/testPlanRegistrations').reply(200, []);
    expect(await api.listTestPlanRegistrations('p1')).toEqual([]);
  });
});

// ---------- VersionSetsApi ----------

describe('VersionSetsApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new VersionSetsApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('getVersionSets calls GET /2.1/projects/:id/version_sets', async () => {
    mock.onGet('/2.1/projects/p1/version_sets').reply(200, []);
    expect(await api.getVersionSets('p1')).toEqual([]);
  });

  it('getVersionSet calls correct URL', async () => {
    mock.onGet('/2.0/projects/p1/version_sets/vs1').reply(200, { id: 'vs1' });
    expect(await api.getVersionSet('p1', 'vs1')).toEqual({ id: 'vs1' });
  });

  it('listFileAreaVersionSets calls correct URL', async () => {
    mock.onGet('/2.1/projects/p1/file_areas/fa1/version_sets').reply(200, []);
    expect(await api.listFileAreaVersionSets('p1', 'fa1')).toEqual([]);
  });

  it('listVersionSetFiles calls correct URL', async () => {
    mock.onGet('/3.0/projects/p1/version_sets/vs1/files').reply(200, []);
    expect(await api.listVersionSetFiles('p1', 'vs1')).toEqual([]);
  });
});

// ---------- WorkPackagesApi ----------

describe('WorkPackagesApi', () => {
  let mock;
  let api;

  beforeEach(() => {
    const { apiClient, mock: m } = createMockedClient();
    mock = m;
    api = new WorkPackagesApi(apiClient);
  });

  afterEach(() => mock.restore());

  it('listWorkPackages calls GET /1.0/projects/:id/workpackages', async () => {
    mock.onGet('/1.0/projects/p1/workpackages').reply(200, []);
    expect(await api.listWorkPackages('p1')).toEqual([]);
  });
});
