// Catalog of the dalux-build-api client surface exposed by the playground.
//
// Shared between the browser UI (to render forms) and the server route
// (to validate + dispatch calls). Only methods listed here can be invoked,
// so this doubles as an allow-list.
//
// Each param `type` maps to a form field and to how the value is coerced:
//   - "string": text input, passed as-is
//   - "json":   textarea, JSON.parse'd before the call (blank -> omitted)
//
// Positional order of `params` === the argument order of the client method.
// Methods that need a filesystem, stdin, or binary streaming (bulk downloads,
// interactive selection, chunked uploads, raw revision content) are omitted
// because they don't make sense over an HTTP console.

const P = {
  projectId: { name: 'projectId', type: 'string', required: true, placeholder: 'e.g. 123456' },
  query: { name: 'params', type: 'json', required: false, label: 'query params (JSON)', placeholder: '{ "updatedAfter": "2024-01-01" }' },
  body: { name: 'body', type: 'json', required: true, label: 'body (JSON)', placeholder: '{ ... }' },
};

export const catalog = {
  projects: {
    label: 'Projects',
    methods: {
      listProjects: { write: false, http: 'GET', desc: 'List all available projects.', params: [P.query] },
      getProject: { write: false, http: 'GET', desc: 'Get a single project by id.', params: [P.projectId] },
      getProjectByName: { write: false, http: 'GET', desc: 'Resolve a projectId from a project name.', params: [{ name: 'projectName', type: 'string', required: true, placeholder: 'My Project' }] },
      listProjectMetadata: { write: false, http: 'GET', desc: 'Metadata of a specific project.', params: [P.projectId] },
      listMetadataMappingsForProjects: { write: false, http: 'GET', desc: 'Metadata available for POST project ops.', params: [] },
      listMetadataValuesForProjects: { write: false, http: 'GET', desc: 'Allowed values for a POST metadata key.', params: [{ name: 'key', type: 'string', required: true, placeholder: 'countryCode' }] },
      listProjectMetadataMappings: { write: false, http: 'GET', desc: 'Metadata available for PATCH project ops.', params: [P.projectId] },
      listProjectMetadataValues: { write: false, http: 'GET', desc: 'Allowed values for a PATCH metadata key.', params: [P.projectId, { name: 'key', type: 'string', required: true, placeholder: 'countryCode' }] },
      createProject: { write: true, http: 'POST', desc: 'Create a new project.', params: [P.body] },
      updateProject: { write: true, http: 'PATCH', desc: 'Update a project.', params: [P.projectId, P.body] },
    },
  },

  companies: {
    label: 'Companies (project)',
    methods: {
      listProjectCompanies: { write: false, http: 'GET', desc: 'Companies on a project.', params: [P.projectId, P.query] },
      getProjectCompany: { write: false, http: 'GET', desc: 'A specific company on a project.', params: [P.projectId, { name: 'companyId', type: 'string', required: true }] },
      createProjectCompany: { write: true, http: 'POST', desc: 'Add a company to a project.', params: [P.projectId, P.body] },
      updateProjectCompany: { write: true, http: 'PATCH', desc: 'Update a company on a project.', params: [P.projectId, { name: 'companyId', type: 'string', required: true }, P.body] },
    },
  },

  companyCatalog: {
    label: 'Company Catalog',
    methods: {
      getCompanies: { write: false, http: 'GET', desc: 'List companies in the catalog.', params: [P.query] },
      getCompany: { write: false, http: 'GET', desc: 'A specific catalog company.', params: [{ name: 'catalogCompanyId', type: 'string', required: true }] },
      getCompanyByName: { write: false, http: 'GET', desc: 'Resolve a catalog company by name.', params: [{ name: 'companyName', type: 'string', required: true }] },
      listCompanyMetadata: { write: false, http: 'GET', desc: 'Metadata of a catalog company.', params: [{ name: 'catalogCompanyId', type: 'string', required: true }] },
      listCompanyMetadataMappings: { write: false, http: 'GET', desc: 'PATCH metadata mappings for a company.', params: [{ name: 'catalogCompanyId', type: 'string', required: true }] },
      listCompanyMetadataValues: { write: false, http: 'GET', desc: 'Allowed values for a company metadata key.', params: [{ name: 'catalogCompanyId', type: 'string', required: true }, { name: 'key', type: 'string', required: true }] },
      listMetadataMappingsForCompanies: { write: false, http: 'GET', desc: 'Metadata available for POST company ops.', params: [] },
      listMetadataValuesForCompanies: { write: false, http: 'GET', desc: 'Allowed values for a POST company metadata key.', params: [{ name: 'key', type: 'string', required: true }] },
      createCompany: { write: true, http: 'POST', desc: 'Create a catalog company.', params: [P.body] },
      updateCompany: { write: true, http: 'PATCH', desc: 'Update a catalog company.', params: [{ name: 'catalogCompanyId', type: 'string', required: true }, P.body] },
    },
  },

  fileAreas: {
    label: 'File Areas',
    methods: {
      getFileAreas: { write: false, http: 'GET', desc: 'File areas on a project.', params: [P.projectId, P.query] },
      getFileArea: { write: false, http: 'GET', desc: 'A specific file area.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }] },
      getFileAreaByName: { write: false, http: 'GET', desc: 'Resolve a file area by name.', params: [P.projectId, { name: 'fileAreaName', type: 'string', required: true }] },
    },
  },

  files: {
    label: 'Files',
    methods: {
      listFiles: { write: false, http: 'GET', desc: 'List files in a file area (single page).', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, P.query] },
      getFile: { write: false, http: 'GET', desc: 'File info by id (no download).', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, { name: 'fileId', type: 'string', required: true }] },
      getFilePropertiesMapping: { write: false, http: 'GET', desc: 'Property mappings for a file.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, { name: 'fileId', type: 'string', required: true }] },
      getFilePropertyMappingValues: { write: false, http: 'GET', desc: 'Allowed values for a file property.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, { name: 'filePropertyId', type: 'string', required: true }] },
    },
  },

  folders: {
    label: 'Folders',
    methods: {
      listFolders: { write: false, http: 'GET', desc: 'List folders in a file area.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, P.query] },
      getFolder: { write: false, http: 'GET', desc: 'A specific folder.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, { name: 'folderId', type: 'string', required: true }] },
      getFolderByPath: { write: false, http: 'GET', desc: 'Resolve a folder by "FileArea/Sub/Folder" path.', params: [P.projectId, { name: 'path', type: 'string', required: true, placeholder: 'Drawings/Architect' }] },
      getFolderByName: { write: false, http: 'GET', desc: 'Resolve a folder by name.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, { name: 'folderName', type: 'string', required: true }, { name: 'parentFolderId', type: 'string', required: false }] },
      getFolderFilesProperties: { write: false, http: 'GET', desc: 'File property definitions for a folder.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, { name: 'folderId', type: 'string', required: true }] },
    },
  },

  forms: {
    label: 'Forms',
    methods: {
      getProjectForms: { write: false, http: 'GET', desc: 'Forms on a project.', params: [P.projectId, P.query] },
      getForm: { write: false, http: 'GET', desc: 'A specific form.', params: [P.projectId, { name: 'formId', type: 'string', required: true }] },
      getProjectFormAttachments: { write: false, http: 'GET', desc: 'Form attachments on a project.', params: [P.projectId, P.query] },
    },
  },

  inspectionPlans: {
    label: 'Inspection Plans',
    methods: {
      listInspectionPlans: { write: false, http: 'GET', desc: 'Inspection plans on a project.', params: [P.projectId, P.query] },
      listInspectionPlanItems: { write: false, http: 'GET', desc: 'Inspection plan items.', params: [P.projectId, P.query] },
      listInspectionPlanItemZones: { write: false, http: 'GET', desc: 'Inspection plan item zones.', params: [P.projectId, P.query] },
      listInspectionPlanRegistrations: { write: false, http: 'GET', desc: 'Inspection plan registrations.', params: [P.projectId, P.query] },
    },
  },

  projectTemplates: {
    label: 'Project Templates',
    methods: {
      listProjectTemplates: { write: false, http: 'GET', desc: 'List project templates.', params: [P.query] },
    },
  },

  tasks: {
    label: 'Tasks',
    methods: {
      getProjectTasks: { write: false, http: 'GET', desc: 'Tasks on a project (single page).', params: [P.projectId, P.query] },
      getTask: { write: false, http: 'GET', desc: 'A specific task.', params: [P.projectId, { name: 'taskId', type: 'string', required: true }] },
      getProjectTaskChanges: { write: false, http: 'GET', desc: 'Task changes on a project.', params: [P.projectId, P.query] },
      getProjectTaskAttachments: { write: false, http: 'GET', desc: 'Task attachments on a project.', params: [P.projectId, P.query] },
    },
  },

  testPlans: {
    label: 'Test Plans',
    methods: {
      listTestPlans: { write: false, http: 'GET', desc: 'Test plans on a project.', params: [P.projectId, P.query] },
      listTestPlanItems: { write: false, http: 'GET', desc: 'Test plan items.', params: [P.projectId, P.query] },
      listTestPlanItemZones: { write: false, http: 'GET', desc: 'Test plan item zones.', params: [P.projectId, P.query] },
      listTestPlanRegistrations: { write: false, http: 'GET', desc: 'Test plan registrations.', params: [P.projectId, P.query] },
    },
  },

  users: {
    label: 'Users',
    methods: {
      getUser: { write: false, http: 'GET', desc: 'A specific user (global).', params: [{ name: 'userId', type: 'string', required: true }] },
      listProjectUsers: { write: false, http: 'GET', desc: 'Users on a project.', params: [P.projectId, P.query] },
      getProjectUser: { write: false, http: 'GET', desc: 'A specific user on a project.', params: [P.projectId, { name: 'userId', type: 'string', required: true }] },
    },
  },

  versionSets: {
    label: 'Version Sets',
    methods: {
      getVersionSets: { write: false, http: 'GET', desc: 'Version sets on a project.', params: [P.projectId, P.query] },
      getVersionSet: { write: false, http: 'GET', desc: 'A specific version set.', params: [P.projectId, { name: 'versionSetId', type: 'string', required: true }] },
      listFileAreaVersionSets: { write: false, http: 'GET', desc: 'Version sets for a file area.', params: [P.projectId, { name: 'fileAreaId', type: 'string', required: true }, P.query] },
      listVersionSetFiles: { write: false, http: 'GET', desc: 'Files in a version set.', params: [P.projectId, { name: 'versionSetId', type: 'string', required: true }, P.query] },
    },
  },

  workPackages: {
    label: 'Work Packages',
    methods: {
      listWorkPackages: { write: false, http: 'GET', desc: 'Work packages on a project.', params: [P.projectId, P.query] },
    },
  },
};
