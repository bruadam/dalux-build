---
"dalux-build-api": patch
"dalux-build": patch
---

Stop emitting spurious `DeprecationWarning`s from `get_files_in_folder` and `bulk_download_folder`, which called the deprecated `get_all_files`/`get_all_files_in_folder` internally.
