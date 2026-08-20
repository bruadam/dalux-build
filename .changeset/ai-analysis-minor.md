---
"dalux-build-api": minor
---

feat: add AI analysis capabilities to API endpoints

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
