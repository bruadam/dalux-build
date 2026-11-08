---
"dalux-build-api": minor
---

Python: the platform retriever can also search, and write to, a person's private project memory on a self-hosted Dalux MCP platform. Pass `platform_memory=True` to `agent()` (or set `DALUX_PLATFORM_MEMORY=1`, or `PlatformRetriever(memory=True)`); the agent then gets a `remember_dalux_note` tool and memory passages appear in its search results. The platform keeps memory off until the person turns it on for a project, and then writes nothing.
