---
"dalux-build-mcp": patch
---

Show the 3D viewer and task timeline MCP Apps in Claude Desktop. Every result an app reads now stays under 100,000 characters (Claude moves results over ~150,000 characters to its code sandbox, so the app never got its data): IFC geometry is packed into chunks by gzip+base64 size instead of 3 MB raw, selections are paged, element details are trimmed when huge, and `view_tasks_timeline` takes at most 200 tasks with titles cut to 200 characters. The viewer draws each chunk as it arrives and shows progress. Both apps call `App.connect()` without a transport, and tools/resources are registered with `registerAppTool`/`registerAppResource`.
