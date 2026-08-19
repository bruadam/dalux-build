"""AI provider configuration from environment variables."""

import os
from typing import Any

from .providers import AIProviderManager, ProviderType


class ProviderConfig:
    """Detects and manages available AI providers from environment variables."""

    # Map of provider to environment variable names for API keys
    PROVIDER_ENV_KEYS = {
        ProviderType.ANTHROPIC: "ANTHROPIC_API_KEY",
        ProviderType.MISTRAL: "MISTRAL_API_KEY",
        ProviderType.OPENAI: "OPENAI_API_KEY",
        ProviderType.OPENROUTER: "OPENROUTER_API_KEY",
    }

    # Default models for each provider
    DEFAULT_MODELS = {
        ProviderType.ANTHROPIC: "claude-3-5-sonnet-20241022",
        ProviderType.MISTRAL: "mistral-large-latest",
        ProviderType.OPENAI: "gpt-4-turbo",
        ProviderType.OPENROUTER: "anthropic/claude-3.5-sonnet",
    }

    @classmethod
    def get_available_providers(cls) -> dict[ProviderType, str]:
        """Get all available providers with their API keys from environment.

        Returns:
            Dictionary mapping ProviderType to API key string.
        """
        available: dict[ProviderType, str] = {}
        for provider, env_key in cls.PROVIDER_ENV_KEYS.items():
            api_key = os.getenv(env_key)
            if api_key:
                available[provider] = api_key
        return available

    @classmethod
    def get_default_provider(cls) -> tuple[ProviderType, str] | None:
        """Get the default provider if only one is configured.

        Returns:
            Tuple of (ProviderType, api_key) if exactly one provider is available,
            None otherwise.
        """
        available = cls.get_available_providers()
        if len(available) == 1:
            provider = list(available.keys())[0]
            return provider, available[provider]
        return None

    @classmethod
    def select_provider_interactive(cls) -> tuple[ProviderType, str] | None:
        """Prompt user to select from available providers.

        Returns:
            Tuple of (ProviderType, api_key) if selection made, None if cancelled.

        Raises:
            ValueError: If no providers are available.
        """
        available = cls.get_available_providers()

        if not available:
            raise ValueError(
                "No AI providers configured. Please set one of these env vars: "
                f"{', '.join(cls.PROVIDER_ENV_KEYS.values())}"
            )

        if len(available) == 1:
            provider = list(available.keys())[0]
            return provider, available[provider]

        # Multiple providers available - show selection menu
        providers_list = list(available.keys())
        print("\n" + "=" * 60)
        print("Multiple AI providers available. Please select one:")
        print("=" * 60)
        for i, provider in enumerate(providers_list, 1):
            model = cls.DEFAULT_MODELS.get(provider, "unknown")
            print(f"  {i}. {provider.value:12} - {model}")
        print()

        while True:
            try:
                choice = input(f"Enter selection (1-{len(providers_list)}): ")
                idx = int(choice) - 1
                if 0 <= idx < len(providers_list):
                    selected_provider = providers_list[idx]
                    return selected_provider, available[selected_provider]
                else:
                    print(f"Please enter a number between 1 and {len(providers_list)}")
            except ValueError:
                print("Invalid input. Please enter a number.")

    @classmethod
    def create_provider_from_env(
        cls,
        provider: ProviderType | str | None = None,
        model: str | None = None,
        interactive: bool = True,
    ) -> AIProviderManager:
        """Create an AI provider manager from environment configuration.

        Args:
            provider: Specific provider to use. If None, auto-detect from env.
            model: Specific model to use. If None, uses provider's default.
            interactive: If True and multiple providers available, show selection menu.

        Returns:
            Configured AIProviderManager instance.

        Raises:
            ValueError: If no providers are configured.
        """
        # Determine which provider to use
        if provider is None:
            if interactive:
                result = cls.select_provider_interactive()
                if result is None:
                    raise ValueError("No provider selected")
                provider, api_key = result
            else:
                default = cls.get_default_provider()
                if default is None:
                    raise ValueError(
                        "No AI provider specified and multiple or zero are configured. "
                        "Set provider explicitly or use interactive=True."
                    )
                provider, api_key = default
        else:
            if isinstance(provider, str):
                provider = ProviderType(provider)

            available = cls.get_available_providers()
            if provider not in available:
                raise ValueError(
                    f"Provider {provider.value} not configured in environment. "
                    f"Set {cls.PROVIDER_ENV_KEYS[provider]} environment variable."
                )
            api_key = available[provider]

        # Use specified model or provider's default
        if model is None:
            model = cls.DEFAULT_MODELS[provider]

        return AIProviderManager(provider=provider, model=model, api_key=api_key)

    @classmethod
    def list_configured_providers(cls) -> dict[str, dict[str, Any]]:
        """List all configured providers with their details.

        Returns:
            Dictionary with provider details.
        """
        available = cls.get_available_providers()
        result = {}
        for provider, api_key in available.items():
            # Don't expose full API key, just show it's set
            masked_key = f"{api_key[:10]}...{api_key[-4:]}" if api_key else None
            result[provider.value] = {
                "available": True,
                "default_model": cls.DEFAULT_MODELS[provider],
                "api_key_set": bool(api_key),
                "api_key_preview": masked_key,
            }

        # Show unavailable providers
        for provider in ProviderType:
            if provider not in available:
                result[provider.value] = {
                    "available": False,
                    "default_model": cls.DEFAULT_MODELS[provider],
                    "api_key_set": False,
                    "env_var_name": cls.PROVIDER_ENV_KEYS[provider],
                }

        return result

    @classmethod
    def print_configured_providers(cls) -> None:
        """Print a formatted list of configured providers."""
        config = cls.list_configured_providers()
        print("\n" + "=" * 70)
        print("AI Providers Configuration")
        print("=" * 70)

        available_count = sum(1 for c in config.values() if c["available"])
        print(f"\nConfigured providers: {available_count}")
        print()

        for provider_name, details in config.items():
            status = "✓ AVAILABLE" if details["available"] else "✗ NOT CONFIGURED"
            print(f"{provider_name:15} {status}")
            print(f"  Default model: {details['default_model']}")

            if details["available"]:
                print(f"  API key: {details['api_key_preview']}")
            else:
                print(f"  To enable: export {details['env_var_name']}=<your-api-key>")
            print()
