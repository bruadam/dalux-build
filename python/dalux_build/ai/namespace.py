"""AI namespace providing analysis methods through dalux.ai.* interface."""

from typing import TYPE_CHECKING

from .mixin import AiMixin

if TYPE_CHECKING:
    from dalux_build import DaluxClient


class AIEndpointProxy(AiMixin):
    """Proxy for an API endpoint that adds AI analysis methods."""

    def __init__(self, endpoint: object, resource_name: str) -> None:
        """Initialize proxy for an endpoint.

        Args:
            endpoint: The API endpoint instance (FilesApi, FoldersApi, etc.)
            resource_name: The resource type name (file, folder, task, etc.)
        """
        self._endpoint = endpoint
        self._resource_name = resource_name

    def _fetch_all_data(self, **kwargs: object) -> list[object]:
        """Fetch all data from the wrapped endpoint."""
        # Map resource types to their endpoint methods
        method_map = {
            "file": "get_all_files",
            "folder": "get_all_folders",
            "task": "get_project_tasks",
            "project": "get_all_projects",
        }
        method_name = method_map.get(self._resource_name, "get_all_files")
        method = getattr(self._endpoint, method_name, None)

        if method is None:
            return []

        result = method(**kwargs)
        if isinstance(result, list):
            return result
        return []

    def _format_data_for_analysis(self, data: list[object]) -> str:
        """Format data for AI analysis."""
        # Delegate to endpoint's formatting if available
        if hasattr(self._endpoint, "_format_data_for_analysis"):
            result = self._endpoint._format_data_for_analysis(data)
            if isinstance(result, str):
                return result
        # Fallback to default
        return super()._format_data_for_analysis(data)

    def __getattr__(self, name: str) -> object:
        """Delegate unknown attributes to the wrapped endpoint."""
        return getattr(self._endpoint, name)


class AINamespace:
    """Provides AI analysis access through dalux.ai.* interface.

    Usage:
        dalux = create_client()
        dalux.ai.files.health()
        dalux.ai.tasks.ask("What tasks are overdue?")
    """

    _client: "DaluxClient"
    _files_proxy: AIEndpointProxy | None
    _folders_proxy: AIEndpointProxy | None
    _tasks_proxy: AIEndpointProxy | None
    _projects_proxy: AIEndpointProxy | None

    def __init__(self, client: "DaluxClient") -> None:
        """Initialize AI namespace.

        Args:
            client: The DaluxClient instance.
        """
        self._client = client
        self._files_proxy = None
        self._folders_proxy = None
        self._tasks_proxy = None
        self._projects_proxy = None

    @property
    def files(self) -> AIEndpointProxy:
        """AI analysis for files endpoint."""
        if self._files_proxy is None:
            self._files_proxy = AIEndpointProxy(self._client.files, "file")
        return self._files_proxy

    @property
    def folders(self) -> AIEndpointProxy:
        """AI analysis for folders endpoint."""
        if self._folders_proxy is None:
            self._folders_proxy = AIEndpointProxy(self._client.folders, "folder")
        return self._folders_proxy

    @property
    def tasks(self) -> AIEndpointProxy:
        """AI analysis for tasks endpoint."""
        if self._tasks_proxy is None:
            self._tasks_proxy = AIEndpointProxy(self._client.tasks, "task")
        return self._tasks_proxy

    @property
    def projects(self) -> AIEndpointProxy:
        """AI analysis for projects endpoint."""
        if self._projects_proxy is None:
            self._projects_proxy = AIEndpointProxy(self._client.projects, "project")
        return self._projects_proxy

    def list_providers(self) -> None:
        """Print list of configured AI providers."""
        from .config import ProviderConfig

        ProviderConfig.print_configured_providers()

    def set_provider(
        self,
        provider: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        """Set the AI provider for all endpoints.

        Args:
            provider: Provider name (anthropic, mistral, openai, openrouter).
            model: Optional model override.
            api_key: Optional API key.
        """
        AiMixin.set_ai_provider(provider=provider, model=model, api_key=api_key)
