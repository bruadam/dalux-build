import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/** Mirrors models/version_sets/models.py::VersionSet. */
export const VersionSetSchema = z.object({
  versionSetId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  fileAreaId: z.string(),
});

export const VersionSetsListResponseSchema = listResponseSchema(VersionSetSchema);
export const VersionSetResponseSchema = singleResponseSchema(VersionSetSchema);
