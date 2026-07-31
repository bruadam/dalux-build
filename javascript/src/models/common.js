'use strict';

const { z } = require('zod');

/**
 * API response link. Mirrors python/dalux_build/models/common.py::Link.
 */
const LinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
  method: z.string().nullish(),
});

/**
 * Response metadata with pagination info. Mirrors common.py::Metadata.
 */
const MetadataSchema = z.object({
  totalItems: z.number().nullish(),
  totalRemainingItems: z.number().nullish(),
});

module.exports = { LinkSchema, MetadataSchema };
