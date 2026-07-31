'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/** Mirrors models/folders/models.py::Folder. */
const FolderSchema = z.object({
  folderId: z.string(),
  folderName: z.string(),
  parentFolderId: z.string().nullish(),
});

const FoldersListResponseSchema = listResponseSchema(FolderSchema);
const FolderResponseSchema = singleResponseSchema(FolderSchema);

module.exports = {
  FolderSchema,
  FoldersListResponseSchema,
  FolderResponseSchema,
};
