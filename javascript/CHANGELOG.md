# dalux-build-api

## 2.0.4

### Patch Changes

- [#19](https://github.com/bruadam/dalux-build/pull/19) [`8b3e0eb`](https://github.com/bruadam/dalux-build/commit/8b3e0eb0d5f5a1fd0c5cfcc72f8eeef3f8d92282) Thanks [@bruadam](https://github.com/bruadam)! - Improve Python webhook monitor observability and testing ergonomics by adding `WebhookServerApi.test_job()` (plus `test_webhook()` alias), periodic scheduler job snapshot logging, and explicit queue/send/success/failure logs for callback delivery attempts. Also update webhook docs and tests to cover the new behavior.

## 2.0.3

### Patch Changes

- [#17](https://github.com/bruadam/dalux-build/pull/17) [`1b5a175`](https://github.com/bruadam/dalux-build/commit/1b5a175456974f0d22d3ba8de2b81c95fe0fbc3b) Thanks [@bruadam](https://github.com/bruadam)! - Fix `VersionSetsApi.download_files` and `get_files_missing_from_version_sets` raising `TypeError: unhashable type: 'FileNameFilter'` when a `FileNameFilter` was passed as an identifier. `FileNameFilter` name-matching logic (contains/startswith/endswith/extensions/regex/wildcard rules) is now shared between `FilesApi` and `VersionSetsApi` via a single `dalux_build.utils.file_filter` utility instead of being duplicated across both.

## 2.0.2

### Patch Changes

- [#13](https://github.com/bruadam/dalux-build/pull/13) [`3c5875c`](https://github.com/bruadam/dalux-build/commit/3c5875cff276956a554131b2763f6c1023b9cbea) Thanks [@bruadam](https://github.com/bruadam)! - Keep the Python package's public `__version__` attribute synchronized with Changesets releases.

- [#13](https://github.com/bruadam/dalux-build/pull/13) [`3c5875c`](https://github.com/bruadam/dalux-build/commit/3c5875cff276956a554131b2763f6c1023b9cbea) Thanks [@bruadam](https://github.com/bruadam)! - Add folder-scoped freshness monitors and guided preview, test, and deletion controls to the webhook UI.

- [#14](https://github.com/bruadam/dalux-build/pull/14) [`8aee696`](https://github.com/bruadam/dalux-build/commit/8aee696df4267189a9eedb3656d2f47998e47404) Thanks [@bruadam](https://github.com/bruadam)! - Return full Project object from get_project_by_name instead of just project ID.
  Add convenience methods to DaluxClient: set_default_project() and
  set_default_file_area(). Expose configuration field on DaluxClient. (Python
  client)

- [#13](https://github.com/bruadam/dalux-build/pull/13) [`3c5875c`](https://github.com/bruadam/dalux-build/commit/3c5875cff276956a554131b2763f6c1023b9cbea) Thanks [@bruadam](https://github.com/bruadam)! - Add file download support to the JavaScript client: `FilesApi.downloadFileBuffer` fetches a file's bytes without writing to disk, and `FileRevisionsApi.getFileRevisionContent` now correctly returns binary content (it previously mishandled it under axios's default JSON responseType). The playground console can now download files and file revisions directly to the browser.

## 2.0.1

### Patch Changes

- [#8](https://github.com/bruadam/dalux-build/pull/8) [`11ed555`](https://github.com/bruadam/dalux-build/commit/11ed555b424c5038453823a9a3dfa0d447714ec6) Thanks [@bruadam](https://github.com/bruadam)! - Align inspection-plan and test-plan models, list responses, and pagination helpers with Python, and add a browser-safe Next.js proxy client that keeps Dalux credentials server-side.

- [#8](https://github.com/bruadam/dalux-build/pull/8) [`11ed555`](https://github.com/bruadam/dalux-build/commit/11ed555b424c5038453823a9a3dfa0d447714ec6) Thanks [@bruadam](https://github.com/bruadam)! - Replace the inbound webhook receiver with persistent cron-based Dalux file monitoring and outbound webhook delivery, including change and freshness jobs.
