"""Configuration for the Dalux Build API client."""


class Configuration:
    """Holds connection settings for the Dalux Build API.

    Args:
        base_url: The API base URL provided by Dalux
            (e.g. ``https://<company>.dalux.com/api``).
        api_key: Your company-specific ``X-API-KEY``.
        use_pydantic: If True, API responses will be converted to Pydantic models
            (default: False to maintain backward compatibility).

    Raises:
        ValueError: If *base_url* or *api_key* is missing.
    """

    def __init__(self, base_url: str, api_key: str, use_pydantic: bool = False) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        if not api_key:
            raise ValueError("api_key is required")

        self.base_url: str = base_url.rstrip("/")
        self.api_key: str = api_key
        self.use_pydantic: bool = use_pydantic
