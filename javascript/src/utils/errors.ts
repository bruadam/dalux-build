/**
 * Base exception for all Dalux API errors.
 */
export class DaluxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Resource not found (HTTP 404).
 */
export class NotFoundError extends DaluxError {}

/**
 * API request failed (4xx / 5xx other than 401, 404, 429).
 */
export class ApiError extends DaluxError {}

/**
 * Input validation failed.
 */
export class ValidationError extends DaluxError {}

/**
 * Authentication failed (HTTP 401).
 */
export class AuthenticationError extends DaluxError {}

/**
 * Rate limit exceeded (HTTP 429).
 */
export class RateLimitError extends DaluxError {}
