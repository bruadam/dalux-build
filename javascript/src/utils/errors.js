'use strict';

/**
 * Base exception for all Dalux API errors.
 */
class DaluxError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Resource not found (HTTP 404).
 */
class NotFoundError extends DaluxError {}

/**
 * API request failed (4xx / 5xx other than 401, 404, 429).
 */
class ApiError extends DaluxError {}

/**
 * Input validation failed.
 */
class ValidationError extends DaluxError {}

/**
 * Authentication failed (HTTP 401).
 */
class AuthenticationError extends DaluxError {}

/**
 * Rate limit exceeded (HTTP 429).
 */
class RateLimitError extends DaluxError {}

module.exports = {
  DaluxError,
  NotFoundError,
  ApiError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
};
