---
"dalux-build-api": minor
---

Add local RAG chat agent capabilities to the Python client.

## What's New

- New `.agent()` method on `dalux.ai.files`, `dalux.ai.folders`, and `dalux.ai.file_areas` that launches a local, skill-driven RAG chat agent over the PDFs in a given scope (file area, folder, or path).
- Local PDF ingestion and vector store built on Chroma with local or provider-hosted embeddings, cached under the platform user cache directory so re-runs only embed new or changed files.
- Pluggable chat model providers: OpenRouter (default) and Mistral, plus an interactive `pick_model` menu for browsing OpenRouter models.
- Skill library (`construction-project-management`, `entrepriseret`, `legal-contract-review`, `general-document-qa`) that grounds agent answers in retrieved document excerpts, selectable via `skill=`.
- Reference document tooling (`byggerietsregler`, Firecrawl-backed crawling) for indexing external regulatory reference material alongside project documents.
- New `dalux-skills` CLI entry point for managing the local skill library.

Requires the new optional `rag` extra: `pip install dalux-build[rag]`.
