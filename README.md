# PM.ai

AI-native task management and orchestration for local coding agents. A Task is
one focused prompt for one repository. Creating a task does not run it; Run,
Queue and Resume express separate execution intent.

## Architecture

```text
    AI clients planning work
Claude Code / Codex / other hosts
       │                 │
     stdio         Streamable HTTP
       │                 │
 apps/mcp          apps/server /mcp
       └── packages/mcp ─┘
                 │
     Existing PM.ai API/services
                 │
        PostgreSQL task backlog
                 │
            Local Agent
                 │
   Codex / Claude Code executing work
```

The AI client planning tasks and the coding agent executing them have distinct
roles, even when both use the same product. Provider credentials stay with the
Local Agent. MCP exposes only defined task operations, never a terminal, file
browser, SQL interface or source code.

- `apps/agent`: local execution, sessions, provider profiles and reconciliation.
- `apps/server`: Fresh/Vite API, public website, MCP, sync and push relay.
- `apps/desktop`, `apps/mobile`: native Tauri clients.
- `apps/mcp`: Deno stdio launcher and read-only remote smoke client.
- `packages/mcp`: the shared SDK v2 server, schemas, tools and resources.
- `packages/core`, `packages/protocol`, `packages/api-client`, `packages/ui`:
  shared domain, validation, clients and UI.

## Run

Install dependencies with `deno install`. Configure the server's PostgreSQL
connection as described in [apps/server/README.md](apps/server/README.md), then:

```sh
deno task server
deno task desktop
deno task mobile
```

MCP uses the existing Companion client token:

```sh
# Set PMAI_SERVER_URL and PMAI_CLIENT_TOKEN through your environment.
deno task mcp
# Read-only check of an existing remote endpoint:
deno task mcp:smoke
```

See [apps/mcp/README.md](apps/mcp/README.md) for Claude Code configuration,
Streamable HTTP authentication, all tools/resources and host limitations.

## Verification

```sh
deno fmt
deno lint
deno check
deno task test
deno task mcp:test
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
```

The integration runner creates and removes a disposable PostgreSQL cluster. It
exercises real HTTP and stdio MCP transports and a fake coding provider; no
Codex/Claude subscriptions or real agent tasks are needed. Database tests are
explicitly skipped by ordinary test commands when `PMAI_TEST_DATABASE_URL` is
absent.
