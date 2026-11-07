"""Discover and pick a tool-capable chat model from Mistral's catalog."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class MistralModel:
    """A Mistral model supporting chat and function calling."""

    id: str
    name: str
    context_length: int | None


def list_mistral_models() -> list[MistralModel]:
    """List Mistral chat models suitable for the RAG agent."""
    from mistralai.client import Mistral

    api_key = os.environ.get("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY must be set to list models.")
    with Mistral(api_key=api_key) as client:
        response = client.models.list()
    return sorted(
        [
            MistralModel(
                id=model.id, name=model.name or model.id, context_length=model.max_context_length
            )
            for model in response.data or []
            if model.capabilities.completion_chat and model.capabilities.function_calling
        ],
        key=lambda model: model.id,
    )


def pick_mistral_model() -> str:
    """Print a numbered model menu and return the selected ID."""
    models = list_mistral_models()
    if not models:
        raise RuntimeError("No Mistral chat models support tool calling.")
    for index, model in enumerate(models, 1):
        print(f"  {index}. {model.id} — {model.context_length or 'unknown'} tokens")
    while True:
        try:
            index = int(input(f"Enter selection (1-{len(models)}): ")) - 1
        except ValueError:
            print("Invalid input. Please enter a number.")
            continue
        if 0 <= index < len(models):
            return models[index].id
        print(f"Please enter a number between 1 and {len(models)}")
