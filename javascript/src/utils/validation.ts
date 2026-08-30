import { ValidationError } from './errors';

/**
 * Validate that projectId is a non-empty string.
 */
export function validateProjectId(projectId: unknown): asserts projectId is string {
  if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new ValidationError('projectId must be a non-empty string');
  }
}

/**
 * Validate that fileAreaId is a non-empty string.
 */
export function validateFileAreaId(fileAreaId: unknown): asserts fileAreaId is string {
  if (!fileAreaId || typeof fileAreaId !== 'string' || fileAreaId.trim().length === 0) {
    throw new ValidationError('fileAreaId must be a non-empty string');
  }
}

/**
 * Validate that folderId is a non-empty string (or null/undefined).
 */
export function validateFolderId(folderId: unknown): void {
  if (folderId == null) return;
  if (typeof folderId !== 'string' || folderId.trim().length === 0) {
    throw new ValidationError('folderId must be a non-empty string');
  }
}
