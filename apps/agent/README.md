# Local Agent

Standalone Deno daemon for local execution and outbound HTTPS synchronization
with the Prompt Waypoint server. Provider processes and credentials stay on this
device.

## Run

Requires Deno 2.9+ (including `node:sqlite`), and installed/authenticated Codex
CLI and/or Claude Code. Authenticate each provider with its own tools. The agent
never reads or copies provider credential files. The official Claude SDK
dependency is pinned in the Deno lockfile and must be cached before fully
offline operation.

```sh
deno task agent
```

The daemon works without desktop or server. Bind is fixed to `127.0.0.1`,
default port `7431`. State defaults to `~/.pmai-agent`; its `local-token` is a
private Prompt Waypoint API token (not a provider credential). Desktop must read
this token locally and use the typed `LocalAgentClient` in
`packages/api-client`.

| Environment                         | Meaning                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `PMAI_AGENT_DIR`                    | Private state directory, SQLite, lock and local API token     |
| `PMAI_AGENT_PORT`                   | Local API port, default 7431                                  |
| `PMAI_DEVICE_NAME`                  | Name used when creating persistent device identity            |
| `PMAI_RECONCILE_MS`                 | Reconciliation interval, default 60000                        |
| `PMAI_CODEX_BIN`, `PMAI_CLAUDE_BIN` | Provider executable paths                                     |
| `PMAI_SERVER_URL`                   | Server HTTPS origin; defaults to `https://promptwaypoint.com` |
| `PMAI_DEVICE_TOKEN`                 | Optional revocable Prompt Waypoint device token from server   |

Use a user launchd/systemd service to supervise `deno task agent` with an
absolute working directory and executable PATH if login persistence is needed.
No service is installed automatically. The exclusive file lock prevents
simultaneous daemons from dispatching through the same database. SIGINT/SIGTERM
closes providers and SQLite; startup always reconciles persisted state.

## Local API

All routes require `Authorization: Bearer <local-token>`. No wildcard CORS:
native Tauri origins are allowed; other browser origins are rejected. The API
does not accept tokens in URLs. Use `/state` for a coherent UI refresh; GET
collection routes also exist.

| Method / route                                               | Payload / result                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| GET `/state`                                                 | Device, repositories with path availability, profiles with capabilities/quota, sessions, executions |
| GET `/repositories`, `/profiles`, `/sessions`, `/executions` | Collection                                                                                          |
| POST `/repositories`                                         | `{name, localPath, defaultProviderProfileId?}`; random identity                                     |
| POST `/profiles`                                             | `{provider, name, configDirectory, autoResume?}`; random identity                                   |
| PATCH `/repositories/:id`                                    | `{name?, defaultProviderProfileId?: string \| null}`                                                |
| PATCH `/profiles/:id`                                        | `{name?, autoResume?}`; changing directory/provider requires a new profile                          |
| DELETE `/repositories/:id`, `/profiles/:id`                  | Reject unfinished executions or referenced default profiles                                         |
| POST `/commands`                                             | Shared runtime-validated command below                                                              |
| POST `/refresh`                                              | Reconcile all profiles                                                                              |
| WS `/events`                                                 | JSON events; subprotocols `pmai-events`, `pmai-auth.<local-token>`                                  |

```ts
const command = {
  commandId: crypto.randomUUID(),
  executionId: crypto.randomUUID(),
  action: "run",
  taskId: "task-id-from-client",
  repositoryId: "registered-repository-id",
  prompt: "Implement the requested task",
  // providerProfileId: "optional-override",
  autoResume: true,
};
```

Retain the same command and execution IDs on retries. `resume`, `sendPrompt`,
and `stop` take an execution ID; `sendPrompt` also requires `prompt`. An
external session can be addressed with `providerProfileId` and `sessionId` plus
client-generated command/execution request IDs, without creating a Task.
Finished executions require a new Run; execution history is retained.

## Persistence and recovery

SQLite uses WAL, FULL synchronous commits and a schema version. Tables store
identity/sync metadata, repositories, profiles, composite-key sessions,
executions, command journal, reconciliation metadata and an acknowledged event
outbox.

Dispatch is serialized. A durable execution in `dispatching` precedes provider
preparation. Its session ID is persisted before prompt submission. The command
journal marks `submitting` before any prompt/stop side effect. A crash before
that boundary proves no prompt was sent: recovery fails the execution and
returns `taskState: "ready"`. A crash after that boundary never automatically
replays the command. Session/turn reconciliation updates actual execution state,
while the original uncertain command result stays uncertain. An orphan empty
prepared thread may be discovered as external; it is never guessed to be a
running Task.

Read timeouts preserve sessions and report `unknown`/`provider_unavailable`,
rather than deleting them. Discovery lists first and inspects
changed/new/inconsistent sessions. Every write re-inspects actual state. An
already active session prevents another resume. Profiles and sessions are keyed
independently: identical provider session IDs in different profiles cannot
collide. A new external session never creates a Task.

Auto-resume requires both profile and execution opt-in, supported quota
inspection, a fresh available capacity observation, and a pre-action inactive
session check. Each interrupted turn has one persistent auto-resume command ID.
Unknown capacity or unknown live state cannot trigger it.

## Provider boundaries

- Codex: isolated App Server JSON-RPC over stdio, one process per `CODEX_HOME`.
  Uses thread list/read/start/resume, turn start/interrupt and account rate
  limits. Status, turns and messages are normalized; provider schemas stay
  inside the adapter. Pagination includes CLI, VS Code, exec and App Server
  sources.
- Claude: isolated official SDK process for `listSessions`/`getSessionMessages`,
  one `CLAUDE_CONFIG_DIR` per process. Runs the installed CLI with print mode
  and structured stream output, and resumes by explicit session ID. Own
  processes provide running/completed/failed observations. Stop targets only
  owned processes.
- External Claude live process state is not exposed by session history. Such
  sessions (including sessions found after a daemon crash) remain `unknown` and
  cannot safely be resumed/stopped by this implementation. Exact Claude quota
  and reset timestamps are explicitly unsupported. No transcript or terminal
  scraping attempts to manufacture these capabilities.
- Codex `notLoaded` plus an unfinished historical turn is also `unknown`;
  persisted history alone does not prove another process is running.
- Live steering and interactive tool approvals are not implemented. The Codex
  RPC client rejects unsupported server requests; it never auto-approves tools.
  Claude permission denials surface as waiting input. Neither adapter bypasses
  provider permission policies. A text follow-up is not a tool-approval
  response.
- Real paid provider execution has not been exercised by the test suite. Codex
  mappings are checked against generated bindings from the installed CLI, and
  Claude streaming is tested with a deterministic executable fixture.

Official interface references:
[Codex App Server](https://developers.openai.com/codex/app-server/),
[Claude programmatic CLI](https://code.claude.com/docs/en/headless),
[Claude session SDK](https://code.claude.com/docs/en/agent-sdk/sessions).

## Server wire contract

See [server setup](../server/README.md#authentication-and-device-pairing) for
pairing.

Set `PMAI_DEVICE_TOKEN` before starting `deno task agent`. The server defaults
to `https://promptwaypoint.com`; set `PMAI_SERVER_URL` to override it. Without a
device token the agent stays local. Existing `wss://<host>/ws/agent`
configuration is accepted by the updated agent and translated to HTTPS. Update
both the server and agent; old WebSocket-only agent binaries are not supported
by the new server.

1. After recovering its local journal, the agent registers metadata with
   `POST /api/agent/connect`, a random session ID and a locally persisted,
   increasing generation per server origin. Provider config directories and
   credentials are excluded.
2. Every four seconds, `POST /api/agent/sync` uploads a bounded batch of outbox
   events and command ACKs, and receives pending commands and committed event
   IDs. Local events trigger an earlier sync. Only acknowledged events are
   removed. Backlogs are drained before the server dispatches new work.
3. Commands are accepted into SQLite before ACK. Provider calls run
   independently of synchronization, so they cannot stop heartbeats. Redelivered
   commands use their original IDs and return the stored result without
   executing twice.
4. Request failures back off up to 60 seconds. The server considers presence
   stale after 45 seconds without a successful sync. A lost response simply
   retries the same outbox events and session. HTTP 401/403/409 stops
   synchronization and logs a pairing/restart message; it never automatically
   reclaims an older session.

All requests require HTTPS and the dedicated device token. A new process fences
out an older one even across server instances. If restoring an older SQLite
backup makes the local generation fall behind, rotate the device token and
restart. Outbox retention remains unbounded while offline; no event is discarded
merely because the server is unavailable.

## Checks

From repository root:

```sh
deno fmt
deno lint
deno check
deno test --allow-read --allow-write --allow-env --allow-net --allow-run
```

`deno task test` runs that test command. Tests use temporary SQLite databases,
fake providers, an empty isolated Claude SDK profile and a CLI fixture. HTTP
integration tests cover lost-response retries, redelivery and synchronization
while a provider is stalled. No provider installation, login or billable request
is required for orchestration tests. The shell fixture runs on Unix; native
Windows fixture portability is not yet covered.
