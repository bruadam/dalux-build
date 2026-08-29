"""Discover and pick a model from OpenRouter's live model catalog."""

from __future__ import annotations

from dataclasses import dataclass

import requests

_MODELS_URL = "https://openrouter.ai/api/v1/models"


@dataclass(frozen=True)
class OpenRouterModel:
    """A model entry from OpenRouter's public ``/models`` catalog."""

    id: str
    name: str
    context_length: int | None
    is_free: bool
    supports_tools: bool


def list_openrouter_models(
    *, free_only: bool = False, require_tools: bool = True, timeout: float = 10.0
) -> list[OpenRouterModel]:
    """Fetch OpenRouter's current model catalog (public endpoint, no API key needed).

    Args:
        free_only: If True, only include models with $0 prompt/completion pricing.
        require_tools: If True (default), only include models that support
            tool/function calling — required for the deep agent's retriever
            tool and deepagents' own filesystem tools. Set False to browse
            the full catalog, but a non-tool-calling model will not work
            with `.agent()`.
        timeout: HTTP request timeout in seconds.

    Returns:
        Models sorted by id, each ready to pass as `.agent(model=<id>)`.
    """
    response = requests.get(_MODELS_URL, timeout=timeout)
    response.raise_for_status()
    entries = response.json().get("data", [])

    models: list[OpenRouterModel] = []
    for entry in entries:
        pricing = entry.get("pricing") or {}
        is_free = pricing.get("prompt") == "0" and pricing.get("completion") == "0"
        supports_tools = "tools" in (entry.get("supported_parameters") or [])
        if free_only and not is_free:
            continue
        if require_tools and not supports_tools:
            continue
        models.append(
            OpenRouterModel(
                id=entry["id"],
                name=entry.get("name", entry["id"]),
                context_length=entry.get("context_length"),
                is_free=is_free,
                supports_tools=supports_tools,
            )
        )
    return sorted(models, key=lambda model: model.id)


def pick_openrouter_model(
    *, free_only: bool = False, require_tools: bool = True, timeout: float = 10.0
) -> str:
    """Print a numbered menu of OpenRouter models and prompt for a choice.

    Mirrors the interactive-selection UX already used for AI provider setup
    (see ``ProviderConfig.select_provider_interactive``).

    Returns:
        The chosen model's id (e.g. ``"z-ai/glm-5.2:free"``), directly usable
        as `.agent(model=...)`.

    Raises:
        RuntimeError: If no models match the given filters.
    """
    models = list_openrouter_models(
        free_only=free_only, require_tools=require_tools, timeout=timeout
    )
    if not models:
        raise RuntimeError("No OpenRouter models matched the given filters.")

    print("\n" + "=" * 70)
    label = " (free tier)" if free_only else ""
    print(f"Available OpenRouter models{label}")
    print("=" * 70)
    for index, model in enumerate(models, 1):
        free_tag = " [free]" if model.is_free else ""
        context = f"{model.context_length:,} tokens" if model.context_length else "unknown context"
        print(f"  {index:>3}. {model.id}{free_tag} — {context}")
    print()

    while True:
        choice = input(f"Enter selection (1-{len(models)}): ")
        try:
            selected_index = int(choice) - 1
        except ValueError:
            print("Invalid input. Please enter a number.")
            continue
        if 0 <= selected_index < len(models):
            return models[selected_index].id
        print(f"Please enter a number between 1 and {len(models)}")
