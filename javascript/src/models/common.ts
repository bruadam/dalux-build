import { z } from 'zod';

/**
 * API response link. Mirrors python/dalux_build/models/common.py::Link.
 */
export const LinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
  method: z.string().nullish(),
});

/**
 * Response metadata with pagination info. Mirrors common.py::Metadata.
 */
export const MetadataSchema = z.object({
  totalItems: z.number().nullish(),
  totalRemainingItems: z.number().nullish(),
});

export type Link = z.infer<typeof LinkSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
