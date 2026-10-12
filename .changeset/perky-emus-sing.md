---
---

Dependency bumps only — no change to published code, so no release.

`javascript/package.json` moves the `axios` and `zod` ranges, which does reach
consumers, but the new ranges ship with the next real release rather than
cutting a version for a dependency bump on its own.
