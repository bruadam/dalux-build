import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/** Mirrors models/folders/models.py::Folder. */
export const FolderSchema = z.object({
  folderId: z.string(),
  folderName: z.string(),
  parentFolderId: z.string().nullish(),
});

export const FoldersListResponseSchema = listResponseSchema(FolderSchema);
export const FolderResponseSchema = singleResponseSchema(FolderSchema);
