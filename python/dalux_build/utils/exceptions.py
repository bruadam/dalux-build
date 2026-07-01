"""Custom exceptions for the Dalux Build API client."""


class DaluxError(Exception):
    """Base exception for all Dalux API errors."""
    pass


class NotFoundError(DaluxError):
    """Resource not found."""
    pass


class ApiError(DaluxError):
    """API request failed."""
    pass


class ValidationError(DaluxError):
    """Input validation failed."""
    pass


class AuthenticationError(DaluxError):
    """Authentication failed."""
    pass


class RateLimitError(DaluxError):
    """Rate limit exceeded."""
    pass