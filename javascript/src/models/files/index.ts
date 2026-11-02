import { z } from 'zod';
import { listResponseSchema, singleResponseSchema, nullableDefault } from '../helpers';
import { ProjectUserSchema } from '../users';

/** Mirrors models/files/models.py::Reference. */
export const ReferenceSchema = z.object({
  key: z.string(),
  value: z.string(),
});

/** Mirrors models/files/models.py::FileIntegerProperty. */
export const FileIntegerPropertySchema = z.object({
  integer: z.number().nullish(),
});

/** Mirrors models/files/models.py::FileDateProperty. */
export const FileDatePropertySchema = z.object({
  date: z.string().nullish(),
});

/** Mirrors models/files/models.py::FileTextProperty. */
export const FileTextPropertySchema = z.object({
  text: z.string().nullish(),
});

/** Mirrors models/files/models.py::FileReferenceProperty. */
export const FileReferencePropertySchema = z.object({
  reference: ReferenceSchema.nullish(),
});

/** Mirrors models/files/models.py::FilePropertyField. */
export const FilePropertyFieldSchema = z.object({
  key: z.string(),
  name: z.string(),
  values: z.array(z.any()).nullish(),
});

/**
 * Mirrors models/files/models.py::FileNameFilter. Client-side filter params
 * (not part of any API response), so field names stay plain camelCase with
 * no aliasing concerns on either side.
 */
export const FileNameFilterSchema = z.object({
  contains: z.array(z.string()).optional(),
  containsMatch: z.enum(['any', 'all']).default('any'),
  notContains: z.array(z.string()).optional(),
  startswith: z.array(z.string()).optional(),
  notStartswith: z.array(z.string()).optional(),
  endswith: z.array(z.string()).optional(),
  notEndswith: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  notExtensions: z.array(z.string()).optional(),
});

/**
 * Mirrors models/files/models.py::File. `uploaded`/`lastModified` are kept
 * as ISO date strings (not coerced to JS Date) so JSON round-tripping and
 * existing string-based consumer code keeps working.
 *
 * `uploadedByUser`/`lastModifiedByUser` are absent from every raw Dalux
 * response — Dalux's files endpoint hands back only the bare id fields next
 * to them. They're populated locally, by `FilesApi`'s `recursivelyPopulate`
 * option resolving the id against a project's users (`userMapping.ts`), the
 * same way Python's `File.uploaded_by_user`/`last_modified_by_user` do.
 */
export const FileSchema = z.object({
  fileId: z.string(),
  fileRevisionId: z.string().nullish(),
  fileName: z.string(),
  fileAreaId: z.string(),
  folderId: z.string().nullish(),
  uploadedByUserId: z.string().nullish(),
  uploadedByUser: ProjectUserSchema.nullish(),
  uploaded: z.string().nullish(),
  lastModifiedByUserId: z.string().nullish(),
  lastModifiedByUser: ProjectUserSchema.nullish(),
  lastModified: z.string().nullish(),
  version: z.string().nullish(),
  deleted: nullableDefault(z.boolean(), false),
  fileType: z.string().nullish(),
  fileSize: z.number().nullish(),
  contentHash: z.string().nullish(),
  downloadLink: z.string().nullish(),
  properties: z.array(FilePropertyFieldSchema).nullish(),
  // Local-only fields set by bulk-download helpers, not present in raw API responses.
  savedFilePath: z.string().nullish(),
  savedMetadataPath: z.string().nullish(),
});

export const FilesListResponseSchema = listResponseSchema(FileSchema);
export const FileResponseSchema = singleResponseSchema(FileSchema);
