'use strict';

const { ValidationError } = require('./errors');

/**
 * Validate that projectId is a non-empty string.
 * @param {string} projectId
 */
function validateProjectId(projectId) {
  if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new ValidationError('projectId must be a non-empty string');
  }
}

/**
 * Validate that fileAreaId is a non-empty string.
 * @param {string} fileAreaId
 */
function validateFileAreaId(fileAreaId) {
  if (!fileAreaId || typeof fileAreaId !== 'string' || fileAreaId.trim().length === 0) {
    throw new ValidationError('fileAreaId must be a non-empty string');
  }
}

/**
 * Validate that folderId is a non-empty string (or null/undefined).
 * @param {string|null|undefined} folderId
 */
function validateFolderId(folderId) {
  if (folderId == null) return;
  if (typeof folderId !== 'string' || folderId.trim().length === 0) {
    throw new ValidationError('folderId must be a non-empty string');
  }
}

module.exports = { validateProjectId, validateFileAreaId, validateFolderId };
