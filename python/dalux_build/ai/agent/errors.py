"""Errors raised by the RAG deep-agent framework."""


class AgentError(Exception):
    """Base class for RAG agent errors."""


class AgentScopeError(AgentError, ValueError):
    """Raised when a file_area/folder scope can't be resolved."""


class MissingAgentDependencies(AgentError, ImportError):
    """Raised when optional 'rag' extra dependencies are not installed."""

    def __init__(self) -> None:
        super().__init__("The RAG agent requires the 'rag' extra: pip install 'dalux-build[rag]'")


class AgentStartupError(AgentError, RuntimeError):
    """Raised when the agent backend or UI process cannot be started."""
