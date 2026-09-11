# PM.ai MCP

One shared `createPmaiMcpServer(context)` factory exposes PM.ai tasks to MCP
hosts. `apps/mcp/main.ts` serves stdio; Fresh serves Streamable HTTP at `/mcp`.
Both use the existing domain services and mutation journal. No MCP tool accesses
PostgreSQL, source files, shells or coding-provider credentials directly.

The pinned official `@modelcontextprotocol/server` and `client` packages are
**2.0.0**, with Zod **4.4.3**. The serving entries are `serveStdio` and
`createMcpHandler`, verified against the installed declarations. The factory
supports the **2026-07-28** protocol and SDK-managed legacy 2025 initialization.
There is no handwritten MCP JSON-RPC dispatcher or standalone SSE endpoint.

## Local stdio

From the monorepo root, after `deno install`:

```sh
# Provide PMAI_SERVER_URL and PMAI_CLIENT_TOKEN in your environment.
deno task mcp
```

`PMAI_SERVER_URL` is the server origin, such as `http://127.0.0.1:8000` locally.
It is not the `/mcp` URL. Remote origins require HTTPS. The token is an existing
PM.ai **Companion client token**, not a Local Agent/device/provider token. The
stdio process calls the normal HTTP API, so the server must be reachable; it
does not need to use the remote MCP endpoint. No local Task database is made.

The process writes only MCP protocol messages to stdout. Startup and transport
errors go to stderr with tokens and connection details omitted. API calls have a
30-second deadline and do not follow redirects with credentials.

### Claude Code

Use an absolute checkout path so the process retains the host's working
directory. Replace `/absolute/path/PM.ai` in this example:

```sh
claude mcp add --transport stdio --scope user pmai -- deno run \
  --config /absolute/path/PM.ai/deno.json \
  --allow-env --allow-net /absolute/path/PM.ai/apps/mcp/main.ts
claude mcp get pmai
```

Launch Claude Code with `PMAI_SERVER_URL` and `PMAI_CLIENT_TOKEN` already set
through your shell or secret manager. Do not put actual tokens in committed
configuration or command history.

Alternatively, a `.mcp.json` configuration can reference host environment
values:

```json
{
  "mcpServers": {
    "pmai": {
      "type": "stdio",
      "command": "deno",
      "args": [
        "run",
        "--config",
        "/absolute/path/PM.ai/deno.json",
        "--allow-env",
        "--allow-net",
        "/absolute/path/PM.ai/apps/mcp/main.ts"
      ],
      "env": {
        "PMAI_SERVER_URL": "${PMAI_SERVER_URL}",
        "PMAI_CLIENT_TOKEN": "${PMAI_CLIENT_TOKEN}"
      }
    }
  }
}
```

These command/config forms follow the
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp). A generic
compatible host can launch the same `deno` command and arguments. No host
settings are installed automatically by this repository.

### Optional current repository

Set **both** `PMAI_AGENT_URL` (a loopback HTTP(S) origin) and `PMAI_AGENT_TOKEN`
(the separate Local Agent API token). Then call `pmai_resolve_repository` with
`{}`. It compares the process's launch cwd to normalized repository paths from
the Local Agent and checks repository/device identity against your server
account. There must be exactly one exact match.

There is no Git lookup, filesystem read, symlink resolution, parent-directory
search or fuzzy auto-selection. If the host launches the process elsewhere,
`deno task` changes cwd to the checkout root, paths differ, the agent is
offline, or matches are ambiguous, choose `repositoryId` explicitly. Host
environment variables such as `CLAUDE_PROJECT_DIR` are not used as filesystem
authority. Remote HTTP clients have no cwd context.

## Remote Streamable HTTP

The endpoint is `<your-server-origin>/mcp`, for example
`https://pmai.example.com/mcp` (documentation placeholder, not a deployment).
Every request except CORS preflight requires:

```http
Authorization: Bearer <PM.ai Companion client token>
```

Tokens are authenticated through the existing `AuthProvider` on each request;
revocation and expiry apply immediately to subsequent calls. Invalid/missing
auth returns 401 with a Bearer challenge. User identity is supplied by the
verified context, never tool arguments. Devices, repositories, tasks and session
metadata remain user-scoped. A future OAuth verifier can replace the
`McpAuthenticator` boundary without changing any tool handler.

Use the same reverse proxy and HTTPS origin as the server API. Preserve MCP
headers and streaming HTTP responses. Browser clients need their exact Origin in
`PMAI_CORS_ORIGINS`; the API's existing origin policy is retained. Nonbrowser
stdio/HTTP clients normally send no Origin. API and agent WebSocket endpoints
retain their existing semantics.

The endpoint is stateless. Legacy session GET/DELETE requests return 405 through
the SDK. Persistent MCP subscriptions are not advertised or supported; read
resources again to refresh them. Existing `/api/events` SSE remains available to
native PM.ai clients.

Limits are in-process and per user: **120 HTTP requests/minute**, including
protocol discovery, and **10 task-creation calls/minute**. The HTTP limiter
returns 429 and `Retry-After: 60`; a creation limit is a structured tool error.
Retries count toward these limits. Requests share the API's **1 MB body limit**;
a batch accepts **1–50 tasks**, with at most 50 dependencies per item, a 300
character title and a 100,000 character prompt. Lists return bounded summaries
(200 devices/repositories; tasks default 20, maximum 100), not a database dump.

### ChatGPT, OpenAI clients and OAuth

The standard transport can be used by hosts that accept a configured Bearer
header. The OpenAI Responses API supports remote Streamable HTTP servers; see
[the official MCP guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).
Configure authorization in your host and keep execution tools behind the host's
approval policy. PM.ai still enforces its own authorization regardless of host
confirmation behavior.

**ChatGPT OAuth account linking is not implemented in this phase.** OpenAI's
[authenticated plugin integration](https://developers.openai.com/apps-sdk/build/auth)
expects OAuth 2.1 and discovery metadata. This server deliberately does not
publish fake authorization-server metadata or offer an anonymous workaround. A
host that only supports that linking flow needs a future real OAuth adapter.
Standard compatibility does not imply this checkout is registered/published as a
ChatGPT app. Actual Claude Code, ChatGPT, Cursor and VS Code sessions have not
been used in automated tests; official SDK clients exercise the wire protocol.

## Tools

Every tool has input/output runtime schemas, structured results, a short text
summary, and read/write/idempotency annotations. Overwriting and execution
operations are marked potentially destructive; execution tools also declare
interaction with the outside environment.

| Tool                         | Purpose                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `pmai_list_devices`          | Device id, name, online and last seen; optional `onlineOnly`               |
| `pmai_list_repositories`     | Repository/device summaries; optional `deviceId` and `query`               |
| `pmai_resolve_repository`    | Case-insensitive exact or partial-name candidates; optional local cwd      |
| `pmai_list_tasks`            | Summaries filtered by repository/statuses, with bounded `limit`            |
| `pmai_get_task`              | Full prompt, dependencies, latest execution/session and provider metadata  |
| `pmai_create_task`           | One Inbox/Ready backlog item; never executes                               |
| `pmai_create_tasks`          | Atomic batch with clientId dependency references; never executes           |
| `pmai_update_task`           | Title/prompt, Inbox/Ready, priority, provider override or null for default |
| `pmai_set_task_dependencies` | Replace dependencies using the existing same-repository DAG validation     |
| `pmai_run_task`              | Explicitly start work, or persist a pending command for an offline device  |
| `pmai_queue_task`            | Explicitly authorize automatic execution once eligible                     |
| `pmai_resume_task`           | Resume a supported existing session                                        |
| `pmai_stop_task`             | Interrupt a supported active session                                       |
| `pmai_send_prompt`           | Send input into a session, including WAITING_INPUT                         |

Exact names on multiple devices are ambiguous. A partial-name candidate never
authorizes automatic selection. Ask the user, then pass the explicit repository
id. Providers are selected through an explicit profile or the repository
default; MCP does not hardcode a provider or model.

`executionMode` accepts `default`, `manual`, or `recommend`. Default/manual are
stored as preferences without making an AI call. The AI Task Router is absent,
so `recommend` returns a clear error and creates nothing. Offline devices do not
block task creation with default/manual. MCP-created tasks carry
`origin: { type: "mcp", client: "MCP client" }`; attribution is not an auth
claim.

### Idempotency and batch example

Every write tool requires **`mutationId`**, a UUID generated once by the caller
for one logical operation. The adapter derives `mcp:<mutationId>` for the
existing durable server journal. Preserve it on retry, even after reconnect or
switching transports. Use a new UUID for intentionally new work. Protocol
request IDs are deliberately not used: different hosts and connections can reuse
them. Different payloads with the same mutationId are rejected.

Call `pmai_create_tasks` with, for example:

```json
{
  "mutationId": "54b941e3-ff3a-4c45-8192-50283ef7ef56",
  "repositoryId": "actual-repository-id",
  "tasks": [
    {
      "clientId": "schema",
      "title": "Add notification schema",
      "prompt": "Implement the notification storage schema.\n\nKeep this task focused on persistence."
    },
    {
      "clientId": "api",
      "title": "Add notification API",
      "prompt": "Add the notification API using the completed schema.",
      "dependsOnClientIds": ["schema"]
    }
  ]
}
```

Both tasks are created in Inbox, in input order. Unknown references, duplicate
clientIds, dependency cycles, invalid profiles or inaccessible/cross-repository
dependencies roll back the whole transaction. The full prompt, including spaces
and line endings, is preserved. A later Run/Queue/Resume requires a separate
explicit tool call and its own mutationId. The task's state remains
authoritative; command acceptance alone does not mean execution completed.

## Resources

| URI                      | Content                                                 |
| ------------------------ | ------------------------------------------------------- |
| `pmai://repositories`    | Up to 200 repository summaries                          |
| `pmai://repository/{id}` | One repository plus up to 20 task summaries             |
| `pmai://tasks`           | The 20 most recently updated task summaries             |
| `pmai://task/{id}`       | One full task and its latest execution/session metadata |

The first and third are discoverable resources; the others are resource
templates. Task/session text is user/agent content, not tool authorization. Some
hosts limit long tool/resource outputs; fetch one task at a time rather than
listing full prompts.

## Verification and Inspector

```sh
deno task mcp:test
# Full tests, including real HTTP/stdio and fake execution, with disposable PG:
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
# Read-only against your configured running server:
deno task mcp:smoke
```

The smoke client performs discovery/initialization, tools/list, a read-only
pmai_list_devices call, resources/list and resources/read. It prints names only,
not tokens or account content. Integration tests additionally cover atomic
rollback, dependencies, multiline prompts, retries across transports, tenant
isolation, revoked tokens, offline devices and explicit fake execution.

For interactive exploration, start the official Inspector using Deno:

```sh
deno run -A npm:@modelcontextprotocol/inspector
```

In Inspector choose **Streamable HTTP**, enter your `/mcp` URL, configure the
Bearer token in its authentication settings, and connect. Inspect Tools and
Resources, then call `pmai_list_devices` and read `pmai://repositories`.
Mutations are optional: use a test repository and a fresh mutationId. For stdio,
choose **STDIO**, command `deno`, and the absolute launch arguments/environment
from above. Inspector is a separate development tool, not a runtime dependency.

SDK references:
[server](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server),
[HTTP serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/http),
[Inspector](https://modelcontextprotocol.io/docs/tools/inspector).
