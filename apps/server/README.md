# PM.ai control-plane server

Deno Fresh 2 API server with PostgreSQL persistence. The desktop/mobile apps
remain separate; this server has no product frontend. Business logic lives under
`src/`; `routes/api` and `routes/ws` register thin programmatic Fresh routes.
Fresh uses its official Vite plugin for development and production builds.
Business services and transport handlers are shared by both modes.

## Start

Requires Deno 2.9+ and PostgreSQL 15+ with an empty application database. From
the repository root, provide `DATABASE_URL` through the environment and run:

```sh
# Development (Fresh + Vite, reload on changes)
deno install
deno task server
# Equivalent: deno task --cwd apps/server dev

# Production (build does not require DATABASE_URL)
deno task --cwd apps/server build
deno task --cwd apps/server start
```

On runtime initialization (first request in development), the server applies
ordered SQL migrations in a transaction protected by a PostgreSQL advisory lock.
Alternatively run `deno task --cwd apps/server migrate` separately. The server
defaults to `127.0.0.1:8000`. `/health` checks database connectivity. `/debug`
is an authenticated, user-scoped JSON summary.

| Variable               | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`         | PostgreSQL connection string; required                             |
| `PMAI_SERVER_HOST`     | Bind address, default `127.0.0.1`                                  |
| `PORT`                 | HTTP port, default `8000`                                          |
| `PMAI_DEV_AUTH_SECRET` | Optional high-entropy bootstrap secret, at least 32 characters     |
| `PMAI_CORS_ORIGINS`    | Additional comma-separated, exact client origins                   |
| `PMAI_APNS_TOPIC`      | Optional APNS application bundle/topic                             |
| `PMAI_APNS_KEY_FILE`   | Server-only path to the Apple APNs PKCS8 `.p8` key                 |
| `PMAI_APNS_KEY_ID`     | Apple APNs Key ID                                                  |
| `PMAI_APNS_TEAM_ID`    | Apple Developer Team ID (JWT issuer)                               |
| `PMAI_APNS_SANDBOX`    | Set `true` for Apple's sandbox endpoint                            |
| `PMAI_FCM_PROJECT`     | Optional FCM project ID                                            |
| `PMAI_FCM_TOKEN_FILE`  | File containing a current Google OAuth access token with FCM scope |

For remote operation, terminate HTTPS/WSS at a reverse proxy and proxy
`/ws/agent` with WebSocket upgrades and `/api/events` with SSE buffering
disabled. Do not expose plain HTTP authentication over an untrusted network.
Normal native Tauri origins are allowed; browser development origins must be
explicitly configured.

`main.ts` exports the Fresh `app`; `app.ts` constructs the same routes for
integration tests. `src/runtime.ts` owns database connections, migrations,
scheduler, push processing and shutdown. Vite reloads close the preceding
runtime before creating another, so background workers and agent connections are
not duplicated. The native config loader lets Deno resolve the workspace's JSR
imports without Vite bundling its own configuration.

In development only, Vite proxies `/ws/agent` to an ephemeral loopback Deno
listener because `Deno.upgradeWebSocket` cannot upgrade Vite's Node requests.
Agents still connect to the same public port and use the same authentication.
Production handles HTTP, SSE and WebSockets directly in Deno, without this
proxy. `serve.ts` serves the generated `_fresh/server.js` while preserving
`PMAI_SERVER_HOST` and `PORT`. SQL migrations are copied into the server build;
deploy the whole `_fresh/` directory alongside `serve.ts` and the Deno workspace
configuration/lockfile. The build is intended for a persistent Deno server
process, including its existing background workers.

## Authentication and device pairing

No external auth framework is required. `AuthProvider` in `src/auth/auth.ts` is
the replaceable authentication boundary. The bundled dev login is disabled
unless `PMAI_DEV_AUTH_SECRET` is explicitly set. Use a random secret from a
secret manager; there is no default password or public user-selection endpoint.

1. POST `/api/auth/dev-login` with `{ "secret": "<configured secret>" }` returns
   a client token and the dev user. Subsequent requests use
   `Authorization: Bearer`.
2. Read the Local Agent's persistent device ID from its authenticated `/state`
   API.
3. POST `/api/devices` with `{id, name, platform}` using the client token. This
   creates a device and returns its dedicated device token once.
4. Configure the agent's `PMAI_SERVER_URL=wss://<host>/ws/agent` and
   `PMAI_DEVICE_TOKEN` using that response. Repository/profile metadata comes
   from the agent's authenticated registration, not from the mobile client.
5. POST `/api/devices/:id/token` rotates a token; DELETE on the same path
   revokes it and disconnects its live agent. A lost pairing response can be
   recovered by rotating the token. These secret-issuing responses are
   deliberately not stored in the mutation journal.

Only SHA-256 hashes of high-entropy client/device tokens are persisted. Client
credentials expire after 30 days; device credentials after 365 days. Revocation
is checked on each HTTP request/agent frame and during heartbeat maintenance.
Logout revokes the current client token. Authenticated SSE connections
periodically recheck credentials; logout also closes that user's live
subscriptions.

The dev bootstrap creates one dev user; the persistence and authorization layers
support multiple isolated users. A production identity provider can replace the
`AuthProvider` injection and login/pairing policy without changing task
services.

Codex/Claude credentials and configuration directories have no cloud schema.
Shared runtime validation rejects additional fields, including
auth/configuration payloads. Only provider metadata, declared capabilities,
quota and normalized sessions/executions enter the database. Provider processes
run exclusively inside the Local Agent.

## Typed API

`ServerClient` is exported from `packages/api-client`. It shares domain types
and runtime request schemas with the server. Desktop/mobile application
implementation is outside this server change; the client is ready for those apps
to consume.

| Method / route                                                                                          | Behavior                                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GET `/api/snapshot`                                                                                     | Consistent read of all user-scoped device/backlog/observed state            |
| GET `/api/devices`, `/repositories`, `/profiles`, `/tasks`, `/dependencies`, `/executions`, `/sessions` | Same collections individually; each path starts with `/api`                 |
| POST `/api/devices`                                                                                     | Pair a persistent Local Agent device identity                               |
| POST / DELETE `/api/devices/:id/token`                                                                  | Rotate / revoke device credentials                                          |
| POST `/api/tasks`                                                                                       | Create with client-generated `id`, repository, title and prompt             |
| GET / PATCH / DELETE `/api/tasks/:id`                                                                   | Read, edit or soft-delete a Task                                            |
| PUT `/api/tasks/:id/dependencies`                                                                       | Replace dependencies with `{dependsOn: [taskId, ...]}`                      |
| POST `/api/tasks/:id/actions`                                                                           | `{action: "run" \| "queue" \| "resume" \| "stop" \| "sendPrompt", prompt?}` |
| GET `/api/commands`                                                                                     | Persistent command lifecycle/results                                        |
| GET / POST `/api/push-registrations`                                                                    | List registration metadata / register `{id, platform, token}`               |
| DELETE `/api/push-registrations/:id`                                                                    | Remove a push registration                                                  |
| POST `/api/auth/logout`                                                                                 | Revoke the current client token                                             |
| GET `/api/events`                                                                                       | Authenticated SSE invalidation stream                                       |
| GET `/ws/agent`                                                                                         | Agent WebSocket upgrade                                                     |

Every Task/dependency/action/push mutation requires an `Idempotency-Key`.
Generate one when the user submits an action and keep it for retries. Reusing a
key with a different payload returns 409. Repository/profile APIs are read-only
for clients: the Local Agent owns those resources and uploads their actual local
metadata.

```ts
import { ServerClient } from "../../packages/api-client/main.ts";

const client = new ServerClient(serverUrl, companionClientToken);
const taskId = crypto.randomUUID();
const createKey = crypto.randomUUID(); // persist with the pending mobile mutation
const task = await client.createTask({
  id: taskId,
  repositoryId,
  title: "Add onboarding",
  prompt: "Implement the onboarding flow.\n\nPreserve existing behavior.",
  status: "ready",
}, createKey);
await client.action(task.id, { action: "run" }, crypto.randomUUID());
```

Task updates accept title, multiline prompt, `inbox`/`ready` state, priority,
position, profile override (or `null` to clear), and quota auto-resume opt-in.
Execution-owned states cannot be assigned through task edits. Editing a Task
with an unfinished execution is rejected. A Task can be reopened/retried after a
terminal execution; a new Run creates a new Execution and preserves history.
Soft deletion retains execution history and rejects active or depended-on Tasks.

Dependencies are a DAG within a repository. Cycle replacement is transactional:
a rejected cycle leaves the previous dependency set intact. Position supports
simple client-controlled reorder; higher priority orders queued dispatch first.

## Dispatch and persistence

PostgreSQL tables cover users, devices, repositories, provider profiles, tasks,
dependencies, executions, sessions, commands and push devices, plus auth hashes,
mutation receipts, event receipts and a durable push queue. JSONB domain
documents sit behind ownership/identity columns, foreign keys and constraints.
There is a partial unique index allowing only one unfinished Execution per Task.

All user mutations take a transaction-scoped advisory lock for that user. Task
transition to `dispatching`, Execution creation, Command creation and
idempotency receipt commit together. Concurrent Run requests with different keys
return the existing active execution's command. A failure before commit leaves
none of these partial changes behind. Commands retain immutable IDs and survive
server restart.

- Creating a Task for an offline device is supported. `ready` never dispatches
  by itself. Run explicitly persists a command even while the target is offline.
- Queue records explicit intent without immediately creating an execution. The
  scheduler dispatches only when the device is connected, dependencies
  completed, a provider profile exists and the repository has no unfinished
  execution or freshly observed active external session.
- Agent ACK changes only command delivery state. It never means that a Task is
  running/completed. Normalized execution events update actual task state.
- A failed/uncertain command result does not fabricate successful execution. A
  proven pre-submit failure can return the Task to `ready`; an uncertain
  dispatch remains `unknown` until actual observation resolves it.
- Event IDs are deduplicated transactionally. Session/execution timestamps
  prevent older observations from replacing newer ones. Finished execution
  history cannot be reopened by stale provider events.
- Local-only task execution events do not create new cloud Tasks. External
  session metadata is cached without creating backlog entries.

## Realtime and reconnect

The wire format matches the existing Local Agent:

```text
agent → hello {version:1, token, device}
server → welcome
agent → registration {device, repositories, profiles}
server → command {command}             # original commandId/executionId
agent → ack {commandId}                # after agent journal commit
agent → commandResult {result}
agent → event {event}
server → eventAck {eventId}            # only after PostgreSQL commit
```

Pending, delivered and acknowledged commands are eligible for redelivery; the
agent journal prevents replayed execution. A new connection supersedes the old
one for that device. Heartbeats and maintenance expire silent sockets after 45
seconds; online status is transient and resets naturally on server restart.

Clients consume SSE `changed` events and refresh one shared snapshot.
`ServerClient` includes authenticated SSE parsing, reconnect backoff and
cancellation. Each connection starts with a refresh event, so reconnect repairs
missed notifications. The 5-second maintenance invalidation also makes stale
cache transitions visible. Session responses include `observedAt` and `stale`;
stale or offline-device sessions report `state: "unknown"` instead of claiming
the agent is still running.

This MVP is intended for one active server process. Socket ownership, online
status and SSE fan-out are in memory; database state survives process restart.
Multi-node routing/fan-out is intentionally not introduced. Mutation/event
journals and history do not yet have retention compaction or list pagination.

## Push notifications

`PushProvider` has APNS and FCM HTTP v1 adapters. The database queue stores only
completion, failure, waiting-input and quota-resume notifications, each with
Task / Session IDs and a `pmai://tasks/<id>` deep link. Provider failures retry
with bounded backoff; workers lease rows using `FOR UPDATE SKIP LOCKED`.
Delivery is at least once, so a crash after external delivery but before its DB
receipt may duplicate a notification.

Without configured push providers, registrations/jobs remain persistent and are
not falsely marked delivered. The APNs provider signs ES256 JWTs locally from
the `.p8` key, using the Key ID in `kid` and Team ID in `iss`. One supplier per
server caches its JWT for 50 minutes and coalesces concurrent signing requests.
At renewal it rereads the key file; restart the process when changing Key ID or
Team ID. Keep the server clock synchronized. Keys are imported as
non-extractable and failures redact key contents and paths. The supplier's
clock/key reader and the push provider's token callback are injectable for
tests.

Mount the key read-only from secret storage, readable only by the server service
account (for a local file, use restrictive permissions such as `chmod 600`).
Never put it in client configuration, static assets or source control. Configure
all four APNs settings together; incomplete configuration and the obsolete
`PMAI_APNS_TOKEN_FILE` fail startup. For TestFlight:

```sh
PMAI_APNS_TOPIC=com.caretsix.aiproductmanager
PMAI_APNS_SANDBOX=false
```

Set `PMAI_APNS_KEY_FILE`, `PMAI_APNS_KEY_ID` and `PMAI_APNS_TEAM_ID` through the
server deployment's secret/configuration system using the actual Apple values.
Debug/device builds use `PMAI_APNS_SANDBOX=true`; keep development and
production registrations in separate server environments. FCM still reads a
current Google OAuth token from its token file; Google token minting is
unchanged. Real APNs and FCM delivery requires account configuration and device
testing and has not been verified by these automated tests.

Interface references:
[Fresh routing](https://usefresh.dev/docs/concepts/routing),
[Postgres.js transactions](https://github.com/porsager/postgres#transactions),
[APNS server](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server),
[FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

## Verification

From the repository root:

```sh
deno fmt
deno lint
deno check
deno task test:integration
```

The integration runner creates a disposable PostgreSQL cluster, runs the
complete workspace `deno test` suite (including Local Agent tests), stops
PostgreSQL and removes its temporary files. It never uses an existing database.
PostgreSQL tools must be on PATH; otherwise set `PMAI_TEST_PG_BIN`, for example
the Homebrew `/opt/homebrew/opt/postgresql@15/bin` directory.

For a separately managed, **test-only** database, set `PMAI_TEST_DATABASE_URL`
and run
`deno test --allow-read --allow-write --allow-env --allow-net --allow-run`.
Tests create unique user/device/task identities. Without this variable,
PostgreSQL integration cases are explicitly skipped; `test:integration` always
sets it.

The tooling integration test builds without database credentials and exercises
production startup on a fresh database, Vite development, authenticated HTTP,
SSE and a real native WebSocket handshake.

Tests cover offline create/queue, concurrent Run, duplicate mutations,
dependency cycles, command transaction rollback, restart persistence, same
names/IDs across devices, stale sessions, tenant isolation, revoked tokens,
event validation, retained history, push envelopes, SSE cleanup and a real
Fresh-to-Local-Agent WebSocket session with reconnect. Provider execution uses
the Fake provider.
