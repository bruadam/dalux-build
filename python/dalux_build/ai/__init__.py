"""AI analysis capabilities for Dalux API endpoints.

This module provides AI-powered analysis methods for any API endpoint using
multiple LLM providers (Anthropic, Mistral, OpenAI, OpenRouter).

Automatically detects available providers from environment variables and shows
an interactive menu if multiple are configured.

Usage (Recommended - through AI namespace):
    from dalux_build import create_client

    dalux = create_client()

    # Auto-detect provider from .env
    health_report = dalux.ai.files.health()
    analysis = dalux.ai.tasks.ask("What are the high-priority tasks?")

    # List providers
    dalux.ai.list_providers()

    # Set provider
    dalux.ai.set_provider("anthropic")

Usage (Direct - for advanced use):
    from dalux_build import AiMixin, ProviderType

    AiMixin.set_ai_provider(ProviderType.ANTHROPIC)
    AiMixin.list_ai_providers()
"""

from .config import ProviderConfig
from .mixin import AiMixin
from .models import AiAnalysisResult, HealthReport
from .namespace import AIEndpointProxy, AINamespace
from .providers import AIProviderManager, ProviderType

__all__ = [
    "AiMixin",
    "HealthReport",
    "AiAnalysisResult",
    "AIProviderManager",
    "ProviderType",
    "ProviderConfig",
    "AINamespace",
    "AIEndpointProxy",
]
