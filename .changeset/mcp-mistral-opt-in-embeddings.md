---
"dalux-build-mcp": patch
---

`DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO=true` is now required for every call that sends document or task text to Mistral, including embeddings for semantic ranking (`search_file_content`, `search_tasks`, file-area, task and docs indexes). Deployments that set only `MISTRAL_API_KEY` now rank with BM25 and get a warning naming the variable. Also: toolsets (`DALUX_MCP_TOOLSETS`, `--toolsets`, `?toolsets=`), shorter tool descriptions, and `modelUsage` on `check_document_consistency`.
