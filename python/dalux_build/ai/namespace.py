"""AI namespace providing analysis methods through dalux.ai.* interface."""

from typing import TYPE_CHECKING

from .mixin import AiMixin

if TYPE_CHECKING:
    from dalux_build import DaluxClient

    from .agent.engine import AgentHandle

_AGENT_CAPABLE_RESOURCES = ("file", "folder", "file_area")


class AIEndpointProxy(AiMixin):
    """Proxy for an API endpoint that adds AI analysis methods."""

    def __init__(
        self, endpoint: object, resource_name: str, client: "DaluxClient | None" = None
    ) -> None:
        """Initialize proxy for an endpoint.

        Args:
            endpoint: The API endpoint instance (FilesApi, FoldersApi, etc.)
            resource_name: The resource type name (file, folder, task, etc.)
            client: The owning DaluxClient. Required for `.agent()`, which
                needs to reach other resource namespaces (file_areas, folders)
                to resolve a scope.
        """
        self._endpoint = endpoint
        self._resource_name = resource_name
        self._client = client

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

    def agent(
        self,
        *,
        folder_id: str | None = None,
        path: str | None = None,
        file_area_id: str | None = None,
        project_id: str | None = None,
        skill: str | None = None,
        provider: str = "openrouter",
        model: str | None = None,
        pick_model: bool = False,
        free_only: bool = False,
        embeddings_provider: str = "local",
        recursive: bool = True,
        file_type: str | None = "document",
        open_browser: bool = True,
        verbose: bool = False,
    ) -> "AgentHandle":
        """Launch a local RAG chat agent over the PDFs in this resource's scope.

        Requires: pip install dalux-build[rag]. Only available on
        dalux.ai.files, dalux.ai.file_areas, and dalux.ai.folders.

        Usage:
            dalux.ai.file_areas.agent(file_area_id="FA123", skill="legal-contract-review")
            dalux.ai.files.agent(folder_id="F456", skill="legal-contract-review")
            dalux.ai.files.agent(path="Files/4_Design/Contracts")
            dalux.ai.files.agent(path="Files/4_Design/Contracts", pick_model=True, free_only=True)
            dalux.ai.files.agent(path="Files/4_Design/Contracts", provider="mistral")

        Args:
            provider: Which chat-model provider to use: "openrouter" (default,
                reads OPENROUTER_API_KEY) or "mistral" (reads MISTRAL_API_KEY).
            model: An explicit model id for the chosen provider (e.g.
                "z-ai/glm-5.2:free" for openrouter, "mistral-large-latest" for
                mistral). Defaults to that provider's default model when omitted.
            pick_model: If True (and *model* is not given), prints an
                interactive numbered menu of OpenRouter models — see
                `dalux_build.ai.agent.pick_openrouter_model` — and uses the
                chosen model. Only valid with provider="openrouter".
            free_only: When picking interactively, only list free-tier models.
            file_type: Restricts indexed PDFs to this ``File.file_type``
                (default ``"document"``). Drawings (``file_type == "drawing"``)
                are always excluded regardless of this value. Pass ``None`` to
                index every non-drawing PDF regardless of file_type.
        """
        if self._resource_name not in _AGENT_CAPABLE_RESOURCES:
            raise NotImplementedError(
                ".agent() is only available on dalux.ai.files, dalux.ai.file_areas, "
                f"and dalux.ai.folders (got resource '{self._resource_name}')."
            )
        if self._client is None:
            raise RuntimeError("AIEndpointProxy.agent() requires a client reference.")

        from .agent.engine import launch_agent
        from .agent.models import pick_openrouter_model
        from .agent.scope import resolve_scope

        if pick_model and provider != "openrouter":
            raise ValueError("pick_model=True is only supported with provider='openrouter'.")
        if model is None and pick_model:
            model = pick_openrouter_model(free_only=free_only)

        scope = resolve_scope(
            self._client,
            file_area_id=file_area_id,
            folder_id=folder_id,
            path=path,
            project_id=project_id,
        )
        return launch_agent(
            scope=scope,
            client=self._client,
            skill=skill,
            provider=provider,
            model=model,
            embeddings_provider=embeddings_provider,
            recursive=recursive,
            file_type=file_type,
            open_browser=open_browser,
            verbose=verbose,
        )


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
    _file_areas_proxy: AIEndpointProxy | None
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
        self._file_areas_proxy = None
        self._tasks_proxy = None
        self._projects_proxy = None

    @property
    def files(self) -> AIEndpointProxy:
        """AI analysis for files endpoint."""
        if self._files_proxy is None:
            self._files_proxy = AIEndpointProxy(self._client.files, "file", client=self._client)
        return self._files_proxy

    @property
    def folders(self) -> AIEndpointProxy:
        """AI analysis for folders endpoint."""
        if self._folders_proxy is None:
            self._folders_proxy = AIEndpointProxy(
                self._client.folders, "folder", client=self._client
            )
        return self._folders_proxy

    @property
    def file_areas(self) -> AIEndpointProxy:
        """AI analysis for file areas endpoint."""
        if self._file_areas_proxy is None:
            self._file_areas_proxy = AIEndpointProxy(
                self._client.file_areas, "file_area", client=self._client
            )
        return self._file_areas_proxy

    @property
    def tasks(self) -> AIEndpointProxy:
        """AI analysis for tasks endpoint."""
        if self._tasks_proxy is None:
            self._tasks_proxy = AIEndpointProxy(self._client.tasks, "task", client=self._client)
        return self._tasks_proxy

    @property
    def projects(self) -> AIEndpointProxy:
        """AI analysis for projects endpoint."""
        if self._projects_proxy is None:
            self._projects_proxy = AIEndpointProxy(
                self._client.projects, "project", client=self._client
            )
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
