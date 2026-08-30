import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/** Mirrors models/file_areas/models.py::FileArea (all fields required). */
export const FileAreaSchema = z.object({
  fileAreaId: z.string(),
  fileAreaName: z.string(),
  fileAreaType: z.string(),
});

export const FileAreasListResponseSchema = listResponseSchema(FileAreaSchema);
export const FileAreaResponseSchema = singleResponseSchema(FileAreaSchema);
