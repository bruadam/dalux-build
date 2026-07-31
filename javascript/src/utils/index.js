'use strict';

const { DaluxError, NotFoundError, ApiError, ValidationError, AuthenticationError, RateLimitError } = require('./errors');
const { hasNextPage, getNextBookmark, paginate } = require('./pagination');
const { findByField, findAllByField } = require('./search');
const { validateProjectId, validateFileAreaId, validateFolderId } = require('./validation');
const { resolveFileAreaByName, resolveFolderIdFromNamedPath } = require('./pathResolver');

module.exports = {
  DaluxError,
  NotFoundError,
  ApiError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  hasNextPage,
  getNextBookmark,
  paginate,
  findByField,
  findAllByField,
  validateProjectId,
  validateFileAreaId,
  validateFolderId,
  resolveFileAreaByName,
  resolveFolderIdFromNamedPath,
};
