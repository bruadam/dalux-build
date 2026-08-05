---
"dalux-build-api": patch
---

Align webhook test payloads with real selected file data: change test events now expose both `changed` and `unchanged` arrays (while keeping `files` as changed-only for compatibility), and freshness test events now include all selected files in `violations`.
