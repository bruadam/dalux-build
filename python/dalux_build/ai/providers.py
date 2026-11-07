"""Mistral chat provider configuration and communication."""

import os
from dataclasses import dataclass
from enum import Enum


class ProviderType(str, Enum):
    """Supported AI model provider."""

    MISTRAL = "mistral"


@dataclass
class ProviderConfig:
    """Configuration for an AI model provider."""

    provider: ProviderType
    model: str
    api_key: str | None = None


class AIProviderManager:
    """Use Mistral for AI analysis."""

    def __init__(
        self,
        provider: ProviderType | str = ProviderType.MISTRAL,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.provider = ProviderType(provider)
        self.model = model or "mistral-large-latest"
        self.api_key = api_key or os.environ.get("MISTRAL_API_KEY")

    def call(self, prompt: str, max_tokens: int = 2048) -> str:
        """Return a Mistral completion."""
        return self._call_mistral(prompt, max_tokens)

    def call_stream(self, prompt: str, max_tokens: int = 2048) -> str:
        """Print streaming output and return the completed response."""
        return self._call_mistral_stream(prompt, max_tokens)

    def _call_mistral(self, prompt: str, max_tokens: int) -> str:
        """Call Mistral API (non-streaming)."""
        try:
            from mistralai.client import Mistral
        except ImportError as e:
            raise ImportError(
                "The 'mistralai' package is required. Install with: pip install mistralai"
            ) from e

        with Mistral(api_key=self.api_key) as client:
            response = client.chat.complete(
                model=self.model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
            )
        return _text(response.choices[0].message.content) if response.choices else ""

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
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],  # type: ignore
        ) as stream:
            for chunk in stream:
                if chunk.data.choices and chunk.data.choices[0].delta.content:
                    text = _text(chunk.data.choices[0].delta.content)
                    response_text += text
                    print(text, end="", flush=True)
        print("\n")
        return response_text

    def call_with_images(self, prompt: str, image_urls: list[str], max_tokens: int = 2048) -> str:
        """Analyze images using a vision-capable Mistral model."""
        from mistralai.client import Mistral
        from mistralai.client.models import ImageURLChunk, TextChunk

        content = [TextChunk(text=prompt), *[ImageURLChunk(image_url=url) for url in image_urls]]
        with Mistral(api_key=self.api_key) as client:
            response = client.chat.complete(
                model=self.model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": content}],  # type: ignore
            )
        return _text(response.choices[0].message.content) if response.choices else ""


def _text(content: object) -> str:
    """Normalize string and text-block completions from the SDK."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [getattr(chunk, "text", "") for chunk in content]
        return "".join(part for part in parts if isinstance(part, str))
    return ""
