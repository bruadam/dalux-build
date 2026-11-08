# Observability: who called what

The platform answers three questions about MCP use: who called which tool, on which connection,
project and files, from where, and what happened. This page lists what is stored, what never is, and
the privacy choices an operator makes.

## What one tool call records (`audit_log`)

One row per tool call. Admin changes in the web interface use the same table (`kind = 'admin'`).

| Group | Columns |
| --- | --- |
| Who | `account_id`, `client` (token name or OAuth client name), `auth_method` (`dxm` API token, `dxo` OAuth, `agent` hosted agent), `credential_id` (API token id or OAuth session id, never the secret), `agent_id`, `agent_name`, `dalux_user_id` |
| Where from | `client_ip`, `forwarded_for`, `user_agent`, `mcp_session_id`, `request_id` |
| What | `action` (tool), `capability`, `connection_id`, `project_id`, `file_area_id`, `folder_id`, `file_ids` (at most 20, `file_count` has the real number) |
| Outcome | `status` (`ok`, `denied`, `error`), `denial_reason` (`missing_capability`, `no_folder_access`, `admin_only`, `no_access_rule`), `error_code` (`not_found`, `rate_limited`, `dalux_auth`, `dalux_error`, `invalid_arguments`, `tool_error`), `duration_ms` |
| Size and cost | `result_items`, `result_bytes`, `result_truncated`, `dalux_calls`, `dalux_errors`, `dalux_rate_limited`, `mistral_tokens` |
| Search text | `query_text`, only while the admin setting **Log search text** is on (off by default) |

**Never stored, in the table or in the logs:** document or task content, tool results, API tokens, OAuth
tokens, Dalux or Mistral keys, passwords. Search and filter text is stored only with **Log search text** on,
and then only in `query_text`, never in the JSON logs. Tests scan the tables, stdout and stderr for this.

## Failed and unauthenticated attempts (`auth_events`)

Invalid, expired or revoked tokens, disabled accounts, wrong or unknown connection slugs, missing or
malformed tokens, OAuth errors (`oauth_*`, including refresh-token reuse) and failed or rate-limited
web sign-ins (`login_failed`, `login_rate_limited`). A row holds the time, reason, IP, user agent, the
connection slug that was asked for, the account when it is known, and the **display prefix** of the token
(`dxm_` plus 8 characters). A string that is not a platform token gets no prefix at all.

## Client IP

Behind Caddy the client address comes from `X-Forwarded-For`, but only as far as `TRUSTED_PROXY_HOPS`
says (default 1 in `compose.yaml`). Entries are counted from the right, so addresses a client puts at the
front of the header are ignored. Caddy also overwrites the header (`header_up X-Forwarded-For {remote_host}`).
With `TRUSTED_PROXY_HOPS=0` the header is ignored and the TCP peer is logged. Change the value if you put
another proxy or load balancer in front of Caddy, one hop per proxy.

Setting **IP logging** (Settings page):

- `full`: the address and the raw `X-Forwarded-For` chain.
- `truncated`: IPv4 /24 (`203.0.113.0/24`) and IPv6 /48; no chain.
- `off`: no address anywhere (table, auth events, logs).

## Privacy (GDPR)

IP addresses, user agents and per-person usage records are personal data. Choices you make as the operator:

- **Legal basis and purpose.** Security monitoring and support are usually a legitimate interest. Write
  that in your records of processing. Tell users that their activity is logged: every user can read their own
  rows under **My activity**.
- **Data minimisation.** Prefer `truncated` unless you need exact addresses to investigate incidents. Leave
  **Log search text** off unless you need it; queries can name people and projects.
- **Two retention periods.** `ip_retention_days` (default 90): the worker clears `client_ip` and
  `forwarded_for` on audit rows and auth events older than this and keeps the rows. The **audit retention**
  setting (default 180 days) deletes whole rows. Keep the IP period shorter than the audit period.
  The worker checks hourly.
- **Access.** Row-level security: a person reads only their own rows; admins read all. The `mcp` role can
  insert but not read the log. Only the worker clears IP columns or deletes rows.
- **Erasure.** Deleting an account sets `account_id` to null on its rows. Clear the IP columns with the
  retention job or by SQL if a request cannot wait.

## Structured logs

The MCP server and the worker write one JSON object per line to **stdout**: `timestamp`, `level`,
`request_id`, `event` (`request`, `auth_failure`, `agent_run`, `ip_retention`; tool calls carry `tool`
instead), `account_id`, `auth_method`, `tool`, `connection`, `project_id`, `status`, `duration_ms`,
`denial_reason`, `error_code`, `result_items`, `result_bytes`, `dalux_calls`, `ip` (as **IP logging**
allows). Every response has an `X-Request-Id` header and error messages end with `(request id …)`.
The same id is in `audit_log.request_id`, so support can go from a user's error to the row and the log line.

On stdio and in Dalux-header mode set `DALUX_MCP_LOG_JSON=1`: the same lines go to **stderr** (stdout is
the protocol channel). They never carry IPs, because there is no proxy and no database.

Shipping to Loki or ELK: the lines are plain Docker logs.

- Loki: run Promtail or Grafana Alloy with the Docker discovery for the `mcp` and `worker` containers and
  a `json` pipeline stage (`request_id`, `level`, `tool`, `status` as labels or structured metadata; keep
  `request_id` out of labels). Query: `{container="dalux-platform-mcp-1"} | json | status="denied"`.
- ELK: run Filebeat with the `container` input and `decode_json_fields` on `message`.

## Metrics

`GET /metrics` (Prometheus text) on `METRICS_PORT` (default 9464) of the `mcp` container. Caddy does not
route it and `compose.yaml` does not publish it; scrape it from inside the Docker network
(`mcp:9464`). Series, with no per-account labels:

- `dalux_mcp_tool_calls_total{tool,status}`
- `dalux_mcp_denials_total{reason}`
- `dalux_mcp_auth_failures_total{reason}`
- `dalux_mcp_tool_duration_seconds` (histogram)
- `dalux_mcp_dalux_errors_total`, `dalux_mcp_dalux_rate_limited_total`
- `dalux_mcp_active_sessions` (credentials seen in the last 5 minutes)
- `dalux_mcp_audit_write_failures_total`

Audit writes never block or fail a tool call. A failed insert is logged to stderr and counted in
`dalux_mcp_audit_write_failures_total`; alert on it.

## Activity in the web interface

- **My activity**: every user sees their own calls and failed attempts.
- **Activity** (admins): all rows with filters, a detail drawer, CSV and JSON export, an overview
  (calls per day, top tools and accounts, denial and error rates, latency p50 and p95, Dalux rate-limit
  hits) and flags: a new IP address, one credential on many IPs in 24 h, a burst of denials, a burst of calls.
  The flags are SQL queries with fixed thresholds (`FLAG_RULES` in `web/lib/server/activity.ts`).
