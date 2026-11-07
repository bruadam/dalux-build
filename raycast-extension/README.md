# Dalux Build for Raycast

Search files, tasks and users in your [Dalux Build](https://www.dalux.com/dalux-build/) projects and open project files, straight from Raycast.

The extension is read-only: it never creates, changes or deletes anything in Dalux.

## Commands

| Command                | What it does                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Search Files**       | Ranked search over every file in all file areas of a project, by file name/number, folder path, file area and type. Without a query it lists the most recently modified files.                                                                   |
| **Open File**          | Browse file areas and folders and open a file. "Search Below This Folder" (`⌘⇧F`) searches one folder tree.                                                                                                                                      |
| **Version Set Files**  | Pick a version set and search or open its files.                                                                                                                                                                                                 |
| **Search Tasks**       | Ranked search over a project's tasks by number, subject, type, workflow, status, responsible, work package, custom fields and recent comments.                                                                                                   |
| **User Tasks**         | Pick a user and see the tasks they are currently responsible for or created.                                                                                                                                                                     |
| **Work Package Tasks** | Pick a work package and see its tasks.                                                                                                                                                                                                           |
| **Search Users**       | Search project users by name, email or company, with a profile pane (email, user type, company, address, VAT number). Copy the email or name, send an email, or show the user's tasks (`⌘T`) or the files they uploaded or last modified (`⌘F`). |

File actions: **Open File** (downloads the current revision and opens it with the default app), **Show in Finder** (`⌘F`), copy file name, folder path or the API download link. Downloads are kept in the extension's support folder, so a revision is only downloaded once.

All lists have a detail pane (`⌘D`) and a reload action (`⌘R`). Every command shares the same project picker in the search bar; the project you picked last is remembered across commands.

## Setup

1. Ask your Dalux administrator for an API key and the API base URL for your company (for example `https://node1.field.dalux.com/service/api`).
2. Fill in the extension preferences:
   - **API Base URL** — must be an `https://….dalux.com` URL.
   - **API Key** — stored in Raycast's encrypted preferences.
   - **Default Project** (optional) — project name, number or ID used until you pick a project.

## Data and caching

Lists are loaded completely (all pages) and cached locally, then searched on your Mac. Cached data shows at once and is reloaded in the background when it is older than:

| Data                                                       | Reload after |
| ---------------------------------------------------------- | ------------ |
| Projects, users, work packages                             | 60 minutes   |
| Tasks                                                      | 10 minutes   |
| Task history (status, responsible, work package, comments) | 60 minutes   |
| Files and version sets                                     | 15 minutes   |

Use **Reload from Dalux** (`⌘R`) to reload at once. Caches are kept per API key and base URL.

Task status, current responsible, work package and comments are not fields of a task in the Dalux API. They come from the project's task change history, which can take a while to load the first time on big projects.

## Development

Uses the published [`dalux-build-api`](https://www.npmjs.com/package/dalux-build-api) client.

```sh
npm install
npm run dev     # ray develop
npm run lint    # ray lint
npm run build   # ray build
npm test        # unit tests for ranking, mapping and pagination
```
