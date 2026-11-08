# Hosted agents

Agents that run on a schedule without an open chat (PRD 6.11). Each one belongs to a person, acts with that
person's access (never more), only reads from Dalux, and writes to two places: the owner's own project memory
(when memory is on for the project) and its run reports. Files: `mcp-server/src/agents/`, tables in migration
0011, pages *My agents* and (admin) *Agents*.

## An agent

Name, instructions, connection and project, a schedule (five-field cron in UTC, at most every 15 minutes, or
manual only), the **capabilities** and **tools** chosen for it, and limits per run: model tokens (default
200,000), tool calls (40) and seconds (600). Templates fill the form and stay editable:

| Template | Schedule | What it does |
| --- | --- | --- |
| Project brief | daily 05:00 | Updates the project's `summary` memory entry from task changes and new file revisions. |
| Consistency watch | daily 02:00 | `check_document_consistency` on the file areas named in the instructions; reports new findings against the previous run's report and keeps an exported Markdown report with the run. |
| Overdue tasks digest | Mondays 06:00 | Lists tasks past their deadline. |

## Access

At every run the worker reads the owner's effective access **now** and keeps the rows that are on the agent's
connection, within its project, and in its capability list (a connection-wide grant becomes a grant on the agent's
project). The agent then calls the tools through the same server code as an MCP request, in process
(`toolLayer.ts`): the access guard, the restricted Dalux client, the Postgres index store under RLS, the memory
tools and the audit log all apply unchanged. Consequences:

- The agent cannot read a project the owner cannot, or use a capability outside its list. A refused call is
  returned to the model as a tool error and is audited as `denied`.
- It runs as a plain user even when the owner is an admin, so it never sees the admin-only index tools.
- Tools outside the agent's tool list are refused without reaching the server.
- Audit rows are written under the **owner's account**; the `client` column reads `hosted agent: <name> (<id>)`.
- Memory entries are written with source `hosted_agent:<id>`, only if the owner switched memory on for the project
  and the agent holds `memory:write`; otherwise the tool answers "Memory is off" / "Missing capability".
- The worker's database role has no grant on memory. Agents therefore need `DATABASE_URL` (the `mcp` role) in the
  worker's environment; the compose file sets it. Without it the worker logs that agents are off.

Tool results reach the model wrapped as `<tool_result trust="untrusted-data">`, and the system prompt says that
documents, tasks and memory are data, not instructions.

## Model

Mistral chat with tool calling. The model is `DALUX_MCP_ANALYSIS_MODEL` (default `mistral-large-latest`). The key
is the admin's key in *Settings* (the embedding key); setting it is the consent to send project text to Mistral.
Without it runs are skipped. `MISTRAL_API_KEY` is not used. Consistency checks inside a run still use the
operator's `MISTRAL_API_KEY` opt-in (see the MCP server README); without it they are lexical only.

## Runs

pg-boss queue `agent-run`, one schedule per enabled agent (key = agent id, kept in step with the agents every
minute), one run at a time per agent. *Run now* sets a flag that the same minute tick turns into a job.

| Status | Meaning | Counts as a failure |
| --- | --- | --- |
| `ok` | The model gave its final report. Resets the failure count. | no |
| `failed` | Model or tool-layer error. The scheduled job is retried once after 5 minutes. | yes |
| `limit` | Token, tool call or time limit hit. The last text is kept as output. | yes |
| `skipped` | Owner disabled, owner lost all chosen capabilities on the project, no Mistral key, or a broken connection. The reason is on the run. | no |
| `stopped` | An admin stopped the agent during the run. | no |

Three failures in a row switch the agent off with the reason shown (the owner resumes it, which clears the count).
Each run stores status, model tokens, tool calls, duration, the report (Markdown) and files such as an exported
consistency report (up to 10 MB each, in `agent_run_files`). The next run is given the previous report to compare
with. Runs left *running* by a stopped worker are marked failed at start.

## Who sees what

- Owners create, edit, pause, run and delete their agents and read all their runs and files.
- Admins see every agent (definition, state, last run's status and token and tool call counts) and can **stop** one
  (it stays off until an admin releases it; the owner cannot resume or edit it). They cannot read run reports or
  files: a report can quote the owner's private memory, which admins cannot read either.
- RLS: `hosted_agents` is readable by its owner and by admins; `agent_runs` and `agent_run_files` only by the owner.
  Admins stop agents through `admin_stop_agent()`, which checks the role. `mcp` has no access to these tables; the
  worker writes runs and the status columns of agents only.

## Not in v1

Delivery of reports by email or webhook, monthly token budgets, event-triggered runs, per-agent time zones.
