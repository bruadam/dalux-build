'use strict';

const { z } = require('zod');

/**
 * Mirrors models/file_upload/models.py::FileUpload — empty placeholder in
 * Python too; upload/part/finalize responses are provider-specific and
 * stay raw in both packages.
 */
const FileUploadSchema = z.object({}).passthrough();

module.exports = { FileUploadSchema };
