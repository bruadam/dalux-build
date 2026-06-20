"""Configuration for the Dalux Build API client."""
import os
from dotenv import load_dotenv
from typing import Optional


class Configuration:
    """Holds connection settings for the Dalux Build API.

    Args:
        base_url: The API base URL provided by Dalux
            (e.g. ``https://<company>.dalux.com/api``).
            If not provided, loads from DALUX_API_BASE_URL environment variable.
        api_key: Your company-specific ``X-API-KEY``.
            If not provided, loads from DALUX_API_KEY environment variable.

    Raises:
        ValueError: If *base_url* or *api_key* is missing.
    """

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        load_dotenv()

        if not base_url:
            base_url = os.getenv("DALUX_API_BASE_URL")
        if not api_key:
            api_key = os.getenv("DALUX_API_KEY")

        if not base_url:
            raise ValueError("base_url is required (or set DALUX_API_BASE_URL env var)")
        if not api_key:
            raise ValueError("api_key is required (or set DALUX_API_KEY env var)")

        self.base_url: str = base_url.rstrip("/")
        self.api_key: str = api_key
