'use strict';

/**
 * Zod schemas for Dalux Build API responses. Mirrors the public surface of
 * python/dalux_build/models/__init__.py, with a `Schema` suffix on every
 * export name (these are zod schema objects, not constructible classes).
 */

const { LinkSchema, MetadataSchema } = require('./common');

const {
  ProjectSchema,
  ProjectModuleSchema,
  ProjectMetadataSchema,
  ProjectTemplateSchema,
  ProjectCompanySchema,
  ProjectsListResponseSchema,
  ProjectResponseSchema,
} = require('./projects');

const { FileAreaSchema, FileAreasListResponseSchema, FileAreaResponseSchema } = require('./fileAreas');

const { FolderSchema, FoldersListResponseSchema, FolderResponseSchema } = require('./folders');

const {
  FileSchema,
  ReferenceSchema,
  FileNameFilterSchema,
  FileIntegerPropertySchema,
  FileDatePropertySchema,
  FileTextPropertySchema,
  FileReferencePropertySchema,
  FilePropertyFieldSchema,
  FilesListResponseSchema,
  FileResponseSchema,
} = require('./files');

const { VersionSetSchema, VersionSetsListResponseSchema, VersionSetResponseSchema } = require('./versionSets');

const { UserSchema, ProjectUserSchema, UsersListResponseSchema, UserResponseSchema } = require('./users');

const { CompaniesListResponseSchema, CompanyResponseSchema } = require('./companies');

const { CompanyCatalogListResponseSchema, CompanyCatalogResponseSchema } = require('./companyCatalog');

const { InspectionPlanSchema, InspectionPlansListResponseSchema } = require('./inspectionPlans');

const { TestPlanSchema, TestPlansListResponseSchema } = require('./testPlans');

const { FormSchema, FormsListResponseSchema, FormResponseSchema } = require('./forms');

const {
  TaskSchema,
  TaskAttachmentSchema,
  TaskChangeSchema,
  TaskChangeActorSchema,
  TaskChangeFieldsSchema,
  TaskChangeLocationSchema,
  TaskListParamsSchema,
  TasksListResponseSchema,
  TaskResponseSchema,
  TaskChangeResponseSchema,
  TaskChangesSchema,
  TaskAttachmentsListResponseSchema,
} = require('./tasks');

const { FileRevisionSchema } = require('./fileRevisions');
const { FileUploadSchema } = require('./fileUpload');
const { WorkPackageSchema, WorkPackagesListResponseSchema } = require('./workPackages');

module.exports = {
  // Base
  LinkSchema,
  MetadataSchema,
  // Projects
  ProjectSchema,
  ProjectModuleSchema,
  ProjectMetadataSchema,
  ProjectTemplateSchema,
  ProjectCompanySchema,
  ProjectsListResponseSchema,
  ProjectResponseSchema,
  // File Areas
  FileAreaSchema,
  FileAreasListResponseSchema,
  FileAreaResponseSchema,
  // Folders
  FolderSchema,
  FoldersListResponseSchema,
  FolderResponseSchema,
  // Files
  FileSchema,
  ReferenceSchema,
  FileNameFilterSchema,
  FileIntegerPropertySchema,
  FileDatePropertySchema,
  FileTextPropertySchema,
  FileReferencePropertySchema,
  FilePropertyFieldSchema,
  FilesListResponseSchema,
  FileResponseSchema,
  // Version Sets
  VersionSetSchema,
  VersionSetsListResponseSchema,
  VersionSetResponseSchema,
  // Users
  UserSchema,
  ProjectUserSchema,
  UsersListResponseSchema,
  UserResponseSchema,
  // Companies
  CompaniesListResponseSchema,
  CompanyResponseSchema,
  // Company Catalog
  CompanyCatalogListResponseSchema,
  CompanyCatalogResponseSchema,
  // Inspection Plans
  InspectionPlanSchema,
  InspectionPlansListResponseSchema,
  // Test Plans
  TestPlanSchema,
  TestPlansListResponseSchema,
  // Forms
  FormSchema,
  FormsListResponseSchema,
  FormResponseSchema,
  // Tasks
  TaskSchema,
  TaskAttachmentSchema,
  TaskChangeSchema,
  TaskChangeActorSchema,
  TaskChangeFieldsSchema,
  TaskChangeLocationSchema,
  TaskListParamsSchema,
  TasksListResponseSchema,
  TaskResponseSchema,
  TaskChangeResponseSchema,
  TaskChangesSchema,
  TaskAttachmentsListResponseSchema,
  // Project Templates (same ProjectTemplateSchema as Projects, re-exported above)
  // File Revisions
  FileRevisionSchema,
  // File Upload
  FileUploadSchema,
  // Work Packages
  WorkPackageSchema,
  WorkPackagesListResponseSchema,
};
