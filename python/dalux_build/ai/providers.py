"""AI provider configuration supporting multiple LLM providers."""

from dataclasses import dataclass
from enum import Enum


class ProviderType(str, Enum):
    """Supported AI model providers."""

    ANTHROPIC = "anthropic"
    MISTRAL = "mistral"
    OPENAI = "openai"
    OPENROUTER = "openrouter"


@dataclass
class ProviderConfig:
    """Configuration for an AI model provider."""

    provider: ProviderType
    model: str
    api_key: str | None = None


class AIProviderManager:
    """Manages AI model provider selection and communication."""

    def __init__(
        self,
        provider: ProviderType | str = ProviderType.ANTHROPIC,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        """Initialize AI provider manager.

        Args:
            provider: The provider to use (default: anthropic).
            model: The model ID to use. If None, uses provider's default.
            api_key: Optional API key. If None, uses environment variables.
        """
        if isinstance(provider, str):
            provider = ProviderType(provider)

        self.provider = provider
        self.model = model or self._get_default_model(provider)
        self.api_key = api_key

    def _get_default_model(self, provider: ProviderType) -> str:
        """Get default model for a provider."""
        defaults = {
            ProviderType.ANTHROPIC: "claude-3-5-sonnet-20241022",
            ProviderType.MISTRAL: "mistral-large-latest",
            ProviderType.OPENAI: "gpt-4-turbo",
            ProviderType.OPENROUTER: "anthropic/claude-3.5-sonnet",
        }
        return defaults.get(provider, "claude-3-5-sonnet-20241022")

    def call(self, prompt: str, max_tokens: int = 2048) -> str:
        """Call the selected provider with the given prompt (no streaming).

        Args:
            prompt: The prompt to send to the model.
            max_tokens: Maximum tokens in response.

        Returns:
            The model's response text.

        Raises:
            ImportError: If the required provider library is not installed.
            ValueError: If provider is not supported.
        """
        if self.provider == ProviderType.ANTHROPIC:
            return self._call_anthropic(prompt, max_tokens)
        elif self.provider == ProviderType.MISTRAL:
            return self._call_mistral(prompt, max_tokens)
        elif self.provider == ProviderType.OPENAI:
            return self._call_openai(prompt, max_tokens)
        elif self.provider == ProviderType.OPENROUTER:
            return self._call_openrouter(prompt, max_tokens)
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")

    def call_stream(self, prompt: str, max_tokens: int = 2048) -> str:
        """Call the selected provider with the given prompt (with streaming output).

        Args:
            prompt: The prompt to send to the model.
            max_tokens: Maximum tokens in response.

        Returns:
            The model's response text.
        """
        print(f"\n📞 Calling {self.provider.value} ({self.model})...")
        if len(prompt) > 100:
            print(f"   📝 Prompt: {prompt[:100]}...")
        else:
            print(f"   📝 Prompt: {prompt}")
        print("   ⏳ Streaming response...\n")

        if self.provider == ProviderType.ANTHROPIC:
            return self._call_anthropic_stream(prompt, max_tokens)
        elif self.provider == ProviderType.MISTRAL:
            return self._call_mistral_stream(prompt, max_tokens)
        elif self.provider == ProviderType.OPENAI:
            return self._call_openai_stream(prompt, max_tokens)
        elif self.provider == ProviderType.OPENROUTER:
            return self._call_openrouter_stream(prompt, max_tokens)
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")

    def _call_anthropic(self, prompt: str, max_tokens: int) -> str:
        """Call Anthropic Claude API (non-streaming)."""
        try:
            from anthropic import Anthropic
        except ImportError as e:
            raise ImportError(
                "The 'anthropic' package is required. Install with: pip install anthropic"
            ) from e

        client = Anthropic(api_key=self.api_key)
        response = client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text if response.content else ""

    def _call_anthropic_stream(self, prompt: str, max_tokens: int) -> str:
        """Call Anthropic Claude API (with streaming)."""
        try:
            from anthropic import Anthropic
        except ImportError as e:
            raise ImportError(
                "The 'anthropic' package is required. Install with: pip install anthropic"
            ) from e

        client = Anthropic(api_key=self.api_key)
        response_text = ""

        print("   Stream: ", end="", flush=True)
        with client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                response_text += text
                print(text, end="", flush=True)
        print("\n")
        return response_text

    def _call_mistral(self, prompt: str, max_tokens: int) -> str:
        """Call Mistral API (non-streaming)."""
        try:
            from mistralai.client import Mistral
        except ImportError as e:
            raise ImportError(
                "The 'mistralai' package is required. Install with: pip install mistralai"
            ) from e

        client = Mistral(api_key=self.api_key)
        response = client.chat.complete(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content if response.choices else ""

    def _call_mistral_stream(self, prompt: str, max_tokens: int) -> str:
        """Call Mistral API (with streaming)."""
        try:
            from mistralai.client import Mistral
        except ImportError as e:
            raise ImportError(
                "The 'mistralai' package is required. Install with: pip install mistralai"
            ) from e

        client = Mistral(api_key=self.api_key)
        response_text = ""

        print("   Stream: ", end="", flush=True)
        with client.chat.stream(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    response_text += text
                    print(text, end="", flush=True)
        print("\n")
        return response_text

    def _call_openai(self, prompt: str, max_tokens: int) -> str:
        """Call OpenAI API (non-streaming)."""
        try:
            from openai import OpenAI
        except ImportError as e:
            raise ImportError(
                "The 'openai' package is required. Install with: pip install openai"
            ) from e

        client = OpenAI(api_key=self.api_key)
        response = client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content or ""

    def _call_openai_stream(self, prompt: str, max_tokens: int) -> str:
        """Call OpenAI API (with streaming)."""
        try:
            from openai import OpenAI
        except ImportError as e:
            raise ImportError(
                "The 'openai' package is required. Install with: pip install openai"
            ) from e

        client = OpenAI(api_key=self.api_key)
        response_text = ""

        print("   Stream: ", end="", flush=True)
        with client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        ) as stream:
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    response_text += text
                    print(text, end="", flush=True)
        print("\n")
        return response_text

    def _call_openrouter(self, prompt: str, max_tokens: int) -> str:
        """Call OpenRouter API (non-streaming)."""
        try:
            from openai import OpenAI
        except ImportError as e:
            raise ImportError(
                "The 'openai' package is required for OpenRouter. Install with: pip install openai"
            ) from e

        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=self.api_key,
        )
        response = client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content or ""

    def _call_openrouter_stream(self, prompt: str, max_tokens: int) -> str:
        """Call OpenRouter API (with streaming)."""
        try:
            from openai import OpenAI
        except ImportError as e:
            raise ImportError(
                "The 'openai' package is required for OpenRouter. Install with: pip install openai"
            ) from e

        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=self.api_key,
        )
        response_text = ""

        print("   Stream: ", end="", flush=True)
        with client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        ) as stream:
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    response_text += text
                    print(text, end="", flush=True)
        print("\n")
        return response_text
