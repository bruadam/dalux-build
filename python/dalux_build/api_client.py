"""Base HTTP client that injects the X-API-KEY header on every request."""
from typing import Any, Dict, Optional
from dotenv import load_dotenv

import requests
import os

from .configuration import Configuration


class ApiClient:
    """Thin wrapper around :mod:`requests` that injects authentication.

    Args:
        configuration: A :class:`~dalux_build.configuration.Configuration`
            instance with *base_url* and *api_key*.
        (Optional) If *configuration* is not provided, the client will attempt to load
        settings from environment variables ``DALUX_API_BASE_URL`` and ``DALUX_API_KEY``.

    Raises:
        ValueError: If *configuration* is ``None``.
    """

    def __init__(self, configuration: Optional[Configuration] = None) -> None:

        if configuration is None:
            load_dotenv() # Load from .env if available
            base_url = os.getenv("DALUX_API_BASE_URL")
            api_key = os.getenv("DALUX_API_KEY")
            if not base_url:
                raise ValueError("DALUX_API_BASE_URL environment variable is required")
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
            }
        )

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
            requests.HTTPError: On 4xx / 5xx responses.
        """
        response = self._session.get(self._url(path), params=params)
        response.raise_for_status()
        return response.json() if response.content else None

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
        """
        response = self._session.post(
            self._url(path), json=json, data=data, params=params, headers=headers
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def patch(
        self,
        path: str,
        json: Any = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Perform a PATCH request.

        Returns:
            Parsed JSON response body.
        """
        response = self._session.patch(self._url(path), json=json, params=params)
        response.raise_for_status()
        return response.json() if response.content else None

    def delete(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """Perform a DELETE request.

        Returns:
            Parsed JSON response body (or ``None`` for empty responses).
        """
        response = self._session.delete(self._url(path), params=params)
        response.raise_for_status()
        return response.json() if response.content else None

    @property
    def configuration(self):
        return self._configuration
