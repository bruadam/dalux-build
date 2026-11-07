---
"dalux-build-api": minor
---

Python: the RAG agent can search a self-hosted Dalux MCP platform's shared indexes instead of a local vector store. Set `DALUX_PLATFORM_URL` and `DALUX_PLATFORM_TOKEN` (a `dxm_` API token or OAuth access token, optionally `DALUX_PLATFORM_CONNECTION`), or pass `platform_url` / `platform_token` / `platform_connection` to `agent()`. New `PlatformRetriever` wraps the platform's `search_file_area`, `search_task_index` and `search_docs` MCP tools as a LangChain retriever. Local mode is unchanged.
