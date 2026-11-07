---
"dalux-build-api": patch
---

Fix `check_consistency`: send `focus` as a list (as the MCP tool expects) and raise `ConsistencyCheckError` instead of a wrapped exception group.
