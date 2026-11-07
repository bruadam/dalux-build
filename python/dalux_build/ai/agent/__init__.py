"""Local deep-agent RAG chat over Dalux PDFs (requires: pip install dalux-build[rag])."""

from .engine import AgentHandle, launch_agent
from .errors import AgentError, AgentScopeError, AgentStartupError, MissingAgentDependencies
from .models import MistralModel, list_mistral_models, pick_mistral_model
from .scope import AgentScope, resolve_pdf_files, resolve_scope

__all__ = [
    "launch_agent",
    "AgentHandle",
    "AgentScope",
    "resolve_scope",
    "resolve_pdf_files",
    "MistralModel",
    "list_mistral_models",
    "pick_mistral_model",
    "AgentError",
    "AgentScopeError",
    "AgentStartupError",
    "MissingAgentDependencies",
]
