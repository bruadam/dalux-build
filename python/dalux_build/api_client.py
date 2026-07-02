"""Base HTTP client that injects the X-API-KEY header on every request."""
from typing import Any, Dict, Optional
import logging

import requests
import os

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from .configuration import Configuration
from .utils.exceptions import ApiError, AuthenticationError, NotFoundError, RateLimitError


class ApiClient:
    """Thin wrapper around :mod:`requests` that injects authentication.

    Args:
        configuration: A :class:`~dalux_build.configuration.Configuration`
            instance with *base_url* and *api_key*.
        (Optional) If *configuration* is not provided, the client will attempt to load
        settings from environment variables ``DALUX_BASE_URL`` and ``DALUX_API_KEY``.

    Raises:
        ValueError: If *configuration* is ``None``.
    """

    def __init__(self, configuration: Optional[Configuration] = None) -> None:
        """Initialize the API client.
        
        Args:
            configuration: Configuration with base_url and api_key.
                           If None, loads from environment variables.
        
        Raises:
            ValueError: If configuration is None and environment variables are missing.
        """
        if configuration is None:
            if load_dotenv is not None:
                load_dotenv()  # Load from .env if available
            base_url = os.getenv("DALUX_BASE_URL")
            api_key = os.getenv("DALUX_API_KEY")
            if not base_url:
                raise ValueError("DALUX_BASE_URL environment variable is required")
            if not api_key:
                raise ValueError("DALUX_API_KEY environment variable is required")
            configuration = Configuration(base_url=base_url, api_key=api_key)

        self._configuration = configuration
        self._session = requests.Session()
        self._session.headers.update(
            {
                "X-API-KEY": configuration.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "dalux-build-python/1.0",
            }
        )
        
        # Configure logging
        self._logger = logging.getLogger(__name__)

    @property
    def base_url(self) -> str:
        return self._configuration.base_url

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """Perform a GET request.

        Args:
            path: URL path (e.g. ``/5.1/projects``).
            params: Optional query-string parameters.

        Returns:
            Parsed JSON response body.

        Raises:
            NotFoundError: When resource is not found (404).
            AuthenticationError: When authentication fails (401).
            RateLimitError: When rate limit is exceeded (429).
            ApiError: For other API errors (4xx/5xx).
        """
        try:
            self._logger.debug(f"GET {path} with params: {params}")
            response = self._session.get(self._url(path), params=params)
            
            if response.status_code == 404:
                raise NotFoundError(f"Resource not found: {path}")
            elif response.status_code == 401:
                raise AuthenticationError("Authentication failed")
            elif response.status_code == 429:
                raise RateLimitError("Rate limit exceeded")
            elif response.status_code >= 400:
                error_detail = self._get_error_detail(response)
                raise ApiError(f"API request failed: {error_detail}")
                
            return response.json() if response.content else None
            
        except requests.RequestException as e:
            self._logger.error(f"GET {path} failed: {e}")
            raise ApiError(f"Request failed: {e}") from e

    def post(
        self,
        path: str,
        json: Any = None,
        data: Any = None,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        """Perform a POST request.

        Args:
            path: URL path.
            json: JSON-serialisable body (sets ``Content-Type: application/json``).
            data: Raw bytes body (overrides *json*).
            params: Optional query-string parameters.
            headers: Extra headers to merge for this request only.

        Returns:
            Parsed JSON response body (or ``None`` for empty responses).

        Raises:
            AuthenticationError: When authentication fails (401).
            RateLimitError: When rate limit is exceeded (429).
            ApiError: For other API errors (4xx/5xx).
        """
        try:
            self._logger.debug(f"POST {path}")
            response = self._session.post(
                self._url(path), json=json, data=data, params=params, headers=headers
            )
            
            if response.status_code == 401:
                raise AuthenticationError("Authentication failed")
            elif response.status_code == 429:
                raise RateLimitError("Rate limit exceeded")
            elif response.status_code >= 400:
                error_detail = self._get_error_detail(response)
                raise ApiError(f"API request failed: {error_detail}")
                
            return response.json() if response.content else None
            
        except requests.RequestException as e:
            self._logger.error(f"POST {path} failed: {e}")
            raise ApiError(f"Request failed: {e}") from e

    def patch(
        self,
        path: str,
        json: Any = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Perform a PATCH request.

        Returns:
            Parsed JSON response body.

        Raises:
            AuthenticationError: When authentication fails (401).
            RateLimitError: When rate limit is exceeded (429).
            ApiError: For other API errors (4xx/5xx).
        """
        try:
            self._logger.debug(f"PATCH {path}")
            response = self._session.patch(self._url(path), json=json, params=params)
            
            if response.status_code == 401:
                raise AuthenticationError("Authentication failed")
            elif response.status_code == 429:
                raise RateLimitError("Rate limit exceeded")
            elif response.status_code >= 400:
                error_detail = self._get_error_detail(response)
                raise ApiError(f"API request failed: {error_detail}")
                
            return response.json() if response.content else None
            
        except requests.RequestException as e:
            self._logger.error(f"PATCH {path} failed: {e}")
            raise ApiError(f"Request failed: {e}") from e

    def delete(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """Perform a DELETE request.

        Returns:
            Parsed JSON response body (or ``None`` for empty responses).

        Raises:
            NotFoundError: When resource is not found (404).
            AuthenticationError: When authentication fails (401).
            RateLimitError: When rate limit is exceeded (429).
            ApiError: For other API errors (4xx/5xx).
        """
        try:
            self._logger.debug(f"DELETE {path}")
            response = self._session.delete(self._url(path), params=params)
            
            if response.status_code == 404:
                raise NotFoundError(f"Resource not found: {path}")
            elif response.status_code == 401:
                raise AuthenticationError("Authentication failed")
            elif response.status_code == 429:
                raise RateLimitError("Rate limit exceeded")
            elif response.status_code >= 400:
                error_detail = self._get_error_detail(response)
                raise ApiError(f"API request failed: {error_detail}")
                
            return response.json() if response.content else None
            
        except requests.RequestException as e:
            self._logger.error(f"DELETE {path} failed: {e}")
            raise ApiError(f"Request failed: {e}") from e
    
    def _get_error_detail(self, response: requests.Response) -> str:
        """Extract error details from failed response."""
        try:
            error_data = response.json()
            if isinstance(error_data, dict):
                if "message" in error_data:
                    return error_data["message"]
                if "error" in error_data:
                    return error_data["error"]
            return str(error_data)
        except (ValueError, TypeError):
            return f"HTTP {response.status_code}: {response.text[:100]}"

    @property
    def configuration(self):
        return self._configuration
