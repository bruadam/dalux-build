import { z } from 'zod';
import { listResponseSchema } from '../helpers';

/** Mirrors models/work_packages/models.py::WorkPackage (extra="allow" -> passthrough). */
export const WorkPackageSchema = z.object({
  workpackageId: z.string().nullish(),
  companyId: z.string().nullish(),
  name: z.string().nullish(),
}).passthrough();

/** No single-item response class in Python. */
export const WorkPackagesListResponseSchema = listResponseSchema(WorkPackageSchema);
