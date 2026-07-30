"""Configuration for the Dalux Build API client."""
import os
from typing import Optional

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def resolve_secret(env_var: str, default: Optional[str] = None) -> Optional[str]:
    """Resolve a secret from the environment, preferring a file-based source.

    If ``<env_var>_FILE`` is set, its contents are read and returned (stripped
    of surrounding whitespace) — this is the convention Docker/Kubernetes
    secrets use when mounting a secret as a file, and matches the ``_FILE``
    suffix supported by official Docker images (e.g. ``POSTGRES_PASSWORD_FILE``).
    Falls back to the plain ``<env_var>`` value, which remains fine for local
    development but should not be relied on in production: it is visible via
    ``docker inspect``, ``/proc/<pid>/environ``, and shell history.
    """
    file_path = os.getenv(f"{env_var}_FILE")
    if file_path:
        with open(file_path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    return os.getenv(env_var, default)


class Configuration:
    """Holds connection settings for the Dalux Build API.

    Args:
        base_url: The API base URL provided by Dalux
            (e.g. ``https://<company>.dalux.com/api``).
            If not provided, loads from DALUX_BASE_URL environment variable.
        api_key: Your company-specific ``X-API-KEY``.
            If not provided, loads from DALUX_API_KEY environment variable.

    Raises:
        ValueError: If *base_url* or *api_key* is missing.
    """

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        if load_dotenv is not None:
            load_dotenv()

        if not base_url:
            base_url = os.getenv("DALUX_BASE_URL")
        if not api_key:
            api_key = resolve_secret("DALUX_API_KEY")

        if not base_url:
            raise ValueError("base_url is required (or set DALUX_BASE_URL env var)")
        if not api_key:
            raise ValueError(
                "api_key is required (or set DALUX_API_KEY / DALUX_API_KEY_FILE env var)"
            )

        self.base_url: str = base_url.rstrip("/")
        self.api_key: str = api_key
