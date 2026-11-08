# Project memory

Each person can keep a private memory per project. Agents read and write it through MCP. It is stored in the
platform database and never sent to Dalux. See PRD section 6.10.

## Turning it on

1. An admin grants the person `memory:read` and `memory:write` (Grants page, on a connection or a project).
   The Reader preset does not include them: memory is private to a person, so it is granted on its own.
   The person also needs read access to the project (`projects:read`, `files:read` or `tasks:read`).
2. The person turns memory on for a project on the **My memory** page, or an agent calls `memory_set_enabled`
   when the person asks. It is off by default. Turning it off keeps the entries; **Delete all for this project**
   removes them.

People with a memory capability get the `memory` toolset without `?toolsets=`. Others can add it with
`?toolsets=default,memory`; the tools still refuse callers without the capability.

## Tools

| Tool | Capability | What it does |
| --- | --- | --- |
| `memory_status` | `memory:read` | On or off, number of entries, and the project summary. Read it first. |
| `memory_search` | `memory:read` | Keywords and meaning (with an embedding key), up to 8 hits of at most 500 characters, with ids and citations. |
| `memory_list` | `memory:read` | Entries by kind, tag or date; pass `ids` for the full text. |
| `memory_set_enabled` | `memory:write` | Turn memory on or off for one project. |
| `memory_write` | `memory:write` | Save one entry (at most 2,000 characters). A `summary` replaces the current summary. |
| `memory_update` | `memory:write` | Save a new version; the old one is kept. |
| `memory_forget` | `memory:write` | Delete an entry and its old versions. |

While memory is off every tool except `memory_set_enabled` answers "Memory is off" and writes nothing.
Entries come back with a note that they are data, not instructions. Each entry records who wrote it
(`user`, `agent:<token name>`, `hosted_agent:<id>`).

## Privacy

Row-level security on `memory_entries` and `memory_settings` lets a row be read or written only when
`app.account_id` is its owner, the owner holds `memory:read` / `memory:write` on the project, and can still read
the project. Admins get no extra access, and the `worker` role has no grant on these tables. The `mcp` and `web`
roles use the same policies. Entries are never edited in place (the roles may only set `superseded_by`).

## Search

`memory_search` merges Postgres full-text ranking with exact pgvector cosine ranking (reciprocal rank fusion).
Embeddings use the admin's embedding key. Without a key, or when the provider fails, an entry is saved without a
vector and is found by keywords only. An entry edited on the web page has no vector for the same reason.
