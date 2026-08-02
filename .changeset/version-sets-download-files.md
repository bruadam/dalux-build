---
"dalux-build-api": patch
---

Fix `VersionSetsApi.download_files` and `get_files_missing_from_version_sets` raising `TypeError: unhashable type: 'FileNameFilter'` when a `FileNameFilter` was passed as an identifier. `FileNameFilter` name-matching logic (contains/startswith/endswith/extensions/regex/wildcard rules) is now shared between `FilesApi` and `VersionSetsApi` via a single `dalux_build.utils.file_filter` utility instead of being duplicated across both.
