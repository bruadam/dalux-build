'use strict';

const { z } = require('zod');

/**
 * Mirrors models/file_revisions/models.py::FileRevision — an empty
 * placeholder in Python too (get_file_revision_content returns raw
 * binary/content in both packages, so there's nothing to validate).
 */
const FileRevisionSchema = z.object({}).passthrough();

module.exports = { FileRevisionSchema };
