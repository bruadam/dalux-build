"""Mixin providing AI analysis capabilities to any API endpoint."""

import json
from typing import Any

from .config import ProviderConfig
from .models import HealthReport
from .providers import AIProviderManager, ProviderType


class AiMixin:
    """Mixin providing AI analysis capabilities to any API endpoint."""

    _resource_name: str = "resource"
    _ai_provider: AIProviderManager | None = None
    _auto_detect_attempted: bool = False

    @classmethod
    def set_ai_provider(
        cls,
        provider: ProviderType | str | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        """Set the AI provider for all instances of this class.

        If provider is None, attempts to auto-detect from environment variables.
        If multiple providers are configured, shows interactive selection menu.

        Args:
            provider: The provider to use. If None, auto-detects from environment.
            model: The model ID to use. If None, uses provider's default.
            api_key: Optional API key. If None, uses environment variables.
        """
        if provider is None:
            # Auto-detect from environment
            try:
                manager = ProviderConfig.create_provider_from_env(
                    provider=None, model=model, interactive=True
                )
                cls._ai_provider = manager
            except ValueError as e:
                print(f"Warning: Could not auto-detect AI provider: {e}")
                cls._ai_provider = None
        else:
            cls._ai_provider = AIProviderManager(provider=provider, model=model, api_key=api_key)

    @classmethod
    def list_ai_providers(cls) -> None:
        """Print a list of all configured AI providers."""
        ProviderConfig.print_configured_providers()

    def _get_provider(self) -> AIProviderManager:
        """Get or create the AI provider instance.

        Auto-detects from environment on first use if not explicitly set.
        """
        if self.__class__._ai_provider is None:
            if not self.__class__._auto_detect_attempted:
                self.__class__._auto_detect_attempted = True
                try:
                    manager = ProviderConfig.create_provider_from_env(
                        provider=None, model=None, interactive=True
                    )
                    self.__class__._ai_provider = manager
                except ValueError as e:
                    self._print_dependency_warning(e)
                    raise
            else:
                self._print_dependency_warning()
                raise ValueError(
                    "No AI provider configured. Please set one using "
                    "AiMixin.set_ai_provider() or configure environment variables."
                )

        return self.__class__._ai_provider

    @staticmethod
    def _print_dependency_warning(error: ValueError | None = None) -> None:
        """Print helpful message about missing AI dependencies."""
        print("\n" + "=" * 70)
        print("AI Analysis requires additional dependencies")
        print("=" * 70)
        print("\nTo install AI support, run:")
        print("  uv sync --extra ai")
        print("\nOr install directly:")
        print("  pip install ai")
        print("\nThen configure an API key in your .env file:")
        print("  ANTHROPIC_API_KEY=sk-ant-...")
        print("  # OR")
        print("  MISTRAL_API_KEY=mistral-...")
        print("  # OR")
        print("  OPENAI_API_KEY=sk-...")
        print("  # OR")
        print("  OPENROUTER_API_KEY=sk-or-...")
        print()
        if error:
            print(f"Error: {error}")
        print("=" * 70 + "\n")

    def health(self, data: list[Any] | None = None, **kwargs: Any) -> HealthReport:  # noqa: ANN401
        """Analyze data health/quality using an AI model.

        If data is not provided, uses the API's list function to fetch all items.

        Args:
            data: Optional list of items to analyze. If None, fetches using
                the endpoint's list function.
            **kwargs: Additional arguments passed to the list function.

        Returns:
            HealthReport with analysis of data quality issues.

        Raises:
            ImportError: If the required provider library is not installed.
            ValueError: If no data is found.
        """
        if data is None:
            data = self._fetch_all_data(**kwargs)

        if not data:
            raise ValueError(f"No {self._resource_name} found to analyze")

        provider = self._get_provider()
        data_summary = self._format_data_for_analysis(data)

        prompt = (
            f"Analyze the following {self._resource_name} items and identify "
            f"quality/health issues.\n\n"
            f"{self._resource_name.upper()} Data:\n"
            f"{data_summary}\n\n"
            f"Return a JSON object with this exact structure (no markdown, just raw JSON):\n"
            f"{{\n"
            f'  "issues": [\n'
            f'    {{"item_identifier": "id or name", "issue": "description of the '
            f'problem", "severity": "low|medium|high"}}\n'
            f"  ],\n"
            f'  "summary": "brief overall health assessment"\n'
            f"}}\n\n"
            f"Focus on:\n"
            f"1. Missing or incomplete data\n"
            f"2. Naming inconsistencies\n"
            f"3. Structural anomalies\n"
            f"4. Invalid formats or values"
        )

        response_text = provider.call(prompt, max_tokens=2048)

        try:
            analysis = json.loads(response_text)
        except json.JSONDecodeError:
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                analysis = json.loads(response_text[start_idx:end_idx])
            else:
                analysis = {"issues": [], "summary": response_text}

        return HealthReport(
            resource_type=self._resource_name,
            total_items_analyzed=len(data),
            analysis=response_text,
            issues=analysis.get("issues", []),
            summary=analysis.get("summary"),
        )

    def ask(self, question: str, data: list[Any] | None = None, **kwargs: Any) -> str:  # noqa: ANN401
        """Ask an AI model a question about the endpoint's data.

        If data is not provided, uses the API's list function to fetch all items.

        Args:
            question: The question to ask about the data.
            data: Optional list of items to analyze. If None, fetches using
                the endpoint's list function.
            **kwargs: Additional arguments passed to the list function.

        Returns:
            The model's answer as a string.

        Raises:
            ImportError: If the required provider library is not installed.
            ValueError: If no data is found.
        """
        if data is None:
            data = self._fetch_all_data(**kwargs)

        if not data:
            raise ValueError(f"No {self._resource_name} found to analyze")

        provider = self._get_provider()
        data_summary = self._format_data_for_analysis(data)

        prompt = f"""You are analyzing {self._resource_name} items. Answer this question:

{question}

{self._resource_name.upper()} Data:
{data_summary}

Provide a direct, concise answer to the question."""

        return provider.call(prompt, max_tokens=2048)

    def _fetch_all_data(self, **kwargs: Any) -> list[Any]:  # noqa: ANN401
        """Fetch all data using the endpoint's list function.

        Subclasses should override this to call their specific list methods.
        """
        raise NotImplementedError(f"{self.__class__.__name__} must implement _fetch_all_data()")

    def _format_data_for_analysis(self, data: list[Any]) -> str:
        """Format data for AI analysis.

        Converts list of items to a readable string representation.
        Subclasses can override for custom formatting.
        """
        import pprint

        return pprint.pformat(data[:100])[:5000]
