# Local Agent

Standalone Deno daemon for Prompt 1. The Fresh server and Tauri applications are
still their original scaffolds. The root Deno workspace currently covers the
agent and its four shared packages; the other applications retain their own
tooling.

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
private Companion API token (not a provider credential). Desktop must read this
token locally and use the typed `LocalAgentClient` in `packages/api-client`.

| Environment                         | Meaning                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `PMAI_AGENT_DIR`                    | Private state directory, SQLite, lock and local API token |
| `PMAI_AGENT_PORT`                   | Local API port, default 7431                              |
| `PMAI_DEVICE_NAME`                  | Name used when creating persistent device identity        |
| `PMAI_RECONCILE_MS`                 | Reconciliation interval, default 60000                    |
| `PMAI_CODEX_BIN`, `PMAI_CLAUDE_BIN` | Provider executable paths                                 |
| `PMAI_SERVER_URL`                   | Optional outbound `wss://` endpoint                       |
| `PMAI_DEVICE_TOKEN`                 | Optional revocable Companion device token from server     |

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

The matching Fresh endpoint is `/ws/agent`; see `../server/README.md` for
pairing.

1. Agent opens WSS, sends `{type:"hello", version:1, token, device}`. The server
   authenticates the token against that device and responds `{type:"welcome"}`.
2. Agent sends `{type:"registration", device, repositories, profiles}`. Profile
   projection excludes configuration directories and credentials.
3. Server sends `{type:"command", command}` using shared command validation. ACK
   is sent only after durable command acceptance, followed by `commandResult`.
4. Agent sends `{type:"event", event}` from the persisted outbox. Server must
   deduplicate `event.id` and send `{type:"eventAck", eventId}` only after
   committing it. Until ACK, events can be re-uploaded. Outbox survives
   restart/offline use.
5. `heartbeat` / `heartbeatAck` run every 15 seconds; 45 seconds without a
   received frame closes the socket. Reconnect uses jittered exponential backoff
   up to 60s. Redelivered commands retain their original IDs and cannot restart
   work.

The server must implement the same handshake and event ACK protocol before cloud
sync can work. Outbox retention is unbounded while offline; operational
compaction is intentionally not implemented in this MVP.

## Checks

From repository root:

```sh
deno fmt
deno lint
deno check
deno test --allow-read --allow-write --allow-env --allow-net --allow-run
```

`deno task test` runs that test command. Tests use temporary SQLite databases,
fake providers, an empty isolated Claude SDK profile and a CLI fixture. A
localhost WebSocket integration test covers reconnect/redelivery. No provider
installation, login or billable request is required for orchestration tests. The
shell fixture runs on Unix; native Windows fixture portability is not yet
covered.
