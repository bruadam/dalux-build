# dalux-build

## 2.2.0

### Minor Changes

- [#78](https://github.com/bruadam/dalux-build/pull/78) [`6cbd92c`](https://github.com/bruadam/dalux-build/commit/6cbd92c6f55bebe9f1ffe06160770d7f87064d3b) Thanks [@bruadam](https://github.com/bruadam)! - feat: add AI analysis capabilities to API endpoints
  
  ## What's New
  
  ### AI Analysis Module
  - **New AI mixin** that adds `.health()` and `.ask()` methods to all API endpoints for AI-powered analysis
  - **Multi-provider support** for Anthropic Claude, Mistral, OpenAI, and OpenRouter
  - **AINamespace** accessible via `client.ai.files`, `client.ai.tasks`, `client.ai.folders`, `client.ai.projects`
  
  ### File Content Analysis
  - **OCR support** for PDFs using Mistral's OCR API
  - **Multimodal analysis** with base64-encoded images for Claude and other providers
  - **Text extraction** from PDFs and image files before sending to AI
  - New `ask()` method on File model for direct file content analysis
  
  ### API Improvements
  - **Method renaming**: `get_all_*()` → `get_*()` with backward-compatible deprecation wrappers
    - `get_all_projects()` → `get_projects()`
    - `get_all_files()` → `get_files()`
    - `get_all_folders()` → `get_folders()`
    - `get_all_project_tasks()` → `get_project_tasks()`
    - `get_all_project_task_changes()` → `get_project_task_changes()`
    - `get_all_files_in_folder()` → `get_files_in_folder()`
  
  ## What's Fixed
  
  - **Type annotations**: Fixed all mypy errors with proper return type hints and generic type handling
  - **Linting issues**: Resolved all ruff violations including:
    - Line length constraints (E501)
    - Proper type annotations for kwargs (ANN401, ANN003)
    - Unused loop variables (B007)
  - **Overload signatures**: Added `# type: ignore[call-overload]` comments for deprecated wrapper methods that call overloaded functions with flexible arguments
  - **Dict type consistency**: Fixed generic dict type annotations in file analysis code
  
  ## Breaking Changes
  
  None. All changes are backward compatible through deprecation wrappers.
  
  ## Usage Example
  
  ```python
  from dalux_build import create_client
  
  client = create_client()
  
  # Analyze files for health issues
  health_report = client.ai.files.health()
  print(health_report.summary)
  
  # Ask questions about tasks
  answer = client.ai.tasks.ask("What are the overdue tasks?")
  
  # Analyze file content
  analysis = client.files.get_file(file_id).ask("Summarize this document")
  ```

- Manual minor release requested from main.

- [`1b4e50a`](https://github.com/bruadam/dalux-build/commit/1b4e50a3617ecfa3301315bacff1fc35a40b4994) Thanks [@bruadam](https://github.com/bruadam)! - Add optional recursive subfolder support to `get_files_in_folder`.

### Patch Changes

- [#79](https://github.com/bruadam/dalux-build/pull/79) [`4a99641`](https://github.com/bruadam/dalux-build/commit/4a99641f36b737f5253371f974f6b6d55ab14f56) Thanks [@bruadam](https://github.com/bruadam)! - Stop emitting spurious `DeprecationWarning`s from `get_files_in_folder` and `bulk_download_folder`, which called the deprecated `get_all_files`/`get_all_files_in_folder` internally.

## 2.1.4

### Patch Changes

- [#51](https://github.com/bruadam/dalux-build/pull/51) [`daf757e`](https://github.com/bruadam/dalux-build/commit/daf757ea7ba65dcdda7483e94f18242f1fe5c0f3) Thanks [@bruadam](https://github.com/bruadam)! - fix: add comprehensive sidebar filters, user/company name resolution, and response deadline coloring to task timeline dashboard
  
  Added new filter controls in the sidebar for the tasks_timeline dashboard:
  - Assignee filter (multiselect)
  - Company filter (multiselect) - filters by user's company
  - Created date range filter (slider)
  - Deadline date range filter (slider)
  
  Updated the filter_timeline_records function to support these new filters, ensuring that all table columns can now be filtered through the sidebar. This addresses issue [#22](https://github.com/bruadam/dalux-build/issues/22) where filters on Streamlit tables should also drive the Graphs data, as all filtering is now done through explicit sidebar controls that affect both the table and graph displays.
  
  Additionally, implemented user and company name resolution:
  - User names are resolved from the users API (first_name + last_name)
  - Company names are resolved from the companies API
  - Both are displayed in the table and graph hover information
  
  Added response deadline configuration:
  - Configurable response deadline in business days (default 10 days)
  - Message exchanges (transitions from assign to completion) that exceed the deadline are highlighted in red in the graph
  - Transitions within the deadline are shown in blue
  - Uses business day calculation excluding weekends and Danish holidays (when holidays library is available)
  
  BREAKING CHANGE: The filter_timeline_records function signature has been updated to include new optional parameters for companies filtering. The build_timeline_records function now accepts user_company_map and company_name_map parameters for name resolution. The build_figure function now accepts a response_deadline_days parameter.

- Manual patch release requested from main.

## 2.1.3

### Patch Changes

- [#54](https://github.com/bruadam/dalux-build/pull/54) [`aa5c7f4`](https://github.com/bruadam/dalux-build/commit/aa5c7f4e8db1c95b4e7107293bc12e8d9b923cab) Thanks [@bruadam](https://github.com/bruadam)! - Align webhook test payloads with real selected file data: change test events now expose both `changed` and `unchanged` arrays (while keeping `files` as changed-only for compatibility), and freshness test events now include all selected files in `violations`.

## 2.1.2

### Patch Changes

- [#47](https://github.com/bruadam/dalux-build/pull/47) [`e4b79fb`](https://github.com/bruadam/dalux-build/commit/e4b79fb72b92c102741e64968a6e2002841e45e4) Thanks [@bruadam](https://github.com/bruadam)! - fix: files ids or file path were not recognised and causing failure on download function in files api

## 2.1.1

### Patch Changes

- [#35](https://github.com/bruadam/dalux-build/pull/35) [`38d19ad`](https://github.com/bruadam/dalux-build/commit/38d19ad1cebf2221aa66547a0ad942b04e559096) Thanks [@bruadam](https://github.com/bruadam)! - Finish wiring `webhook-ui` to Supabase as a real multi-tenant backend: Supabase Auth (email/password + optional OAuth) replaces the half-migrated Clerk setup, saved Dalux credentials and registered webhooks are now persisted and manageable from new "Credentials" and "Webhooks" sidebar pages, and webhook limits are enforced per subscription tier.

  The monitor service gains an optional `testCallback` alongside the production `callback` (e.g. n8n's `/webhook-test/` vs `/webhook/` URLs), and `POST /jobs/{id}/test` now builds its event from real, currently-selected Dalux files instead of a placeholder. `PATCH /jobs/{id}` can pause/resume a job without deleting it, re-arming the schedule on resume so a paused job doesn't fire a backlog of missed runs.

## 2.1.0

### Minor Changes

- [#21](https://github.com/bruadam/dalux-build/pull/21) [`b1dc423`](https://github.com/bruadam/dalux-build/commit/b1dc4236b952496012b89f0c4d1a40ddb2723555) Thanks [@bruadam](https://github.com/bruadam)! - Add a resource-wide Python dashboard engine and the Streamlit task timeline
  template.

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
