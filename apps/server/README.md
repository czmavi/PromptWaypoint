# Prompt Waypoint control-plane server

Deno Fresh 2 API server with PostgreSQL persistence. The desktop/mobile apps
remain separate; this server serves a public read-only promotional page.
Business logic lives under `src/`; `routes/api` registers thin programmatic
Fresh routes. Fresh uses its official Vite plugin for development and production
builds. Business services and transport handlers are shared by both modes.

## Public website

`/` is a public Fresh SSR landing page. It contains static product examples, not
account data, and does not query PostgreSQL or call business services. The
server's existing runtime initialization still requires PostgreSQL.

| Route                                   | Purpose                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `/`                                     | Public marketing page                                                               |
| `/marketing/*`                          | Public stylesheet and existing Prompt Waypoint brand icon                           |
| `/api/*`                                | Existing authenticated Prompt Waypoint API (bootstrap login retains its own policy) |
| `/api/agent/connect`, `/api/agent/sync` | Device-authenticated HTTPS synchronization                                          |
| `/api/revision`                         | Authenticated revision for client polling                                           |
| `/mcp`                                  | Authenticated MCP Streamable HTTP endpoint                                          |

MCP integration is available for compatible clients with a configured Prompt
Waypoint Bearer token. The optional AI Task Router remains planned. The public
page never reads account data.

Optional `PMAI_PUBLIC_URL` sets the public HTTP(S) origin used for canonical,
Open Graph URL/image and Twitter image metadata, e.g. your actual deployment
origin. Paths, queries and fragments are removed; invalid or credential-bearing
URLs are ignored. The default public origin is `https://promptwaypoint.com`. The
social image reuses the existing 1024px Prompt Waypoint iOS icon; the
header/favicon use an 80px copy to keep page downloads small. The public origin
can be overridden for a self-hosted deployment.

The page has no islands, forms, tracking, account UI or production JavaScript.
FAQ disclosures and anchor navigation work natively, with responsive CSS and
reduced-motion support. A restrictive page-only CSP blocks scripts and network
connections; Fresh/Vite's development-only live-reload scripts may therefore be
blocked on this route. Refresh the page manually during development. API
responses retain their existing security behavior. Public static file handling
is restricted to `/marketing/*` to avoid shadowing backend routes. The server
uses Preact’s `react-jsx` transform so Vite development SSR receives ordinary
VNodes rather than already-precompiled templates. Production SSR and development
rendering are both covered by the tooling integration test.

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

For remote operation, use HTTPS (provided by Deno Deploy, or terminate TLS at a
reverse proxy). All cloud synchronization uses short HTTP requests. Do not
expose plain HTTP authentication over an untrusted network. Normal native Tauri
origins are allowed; browser development origins must be explicitly configured.

`main.ts` exports the Fresh `app`; `app.ts` constructs the same routes for
integration tests. `src/runtime.ts` owns database connections, migrations,
request-scoped scheduling, push processing and shutdown. Vite reloads close the
preceding runtime before creating another, so database resources are closed
before replacement. The native config loader lets Deno resolve the workspace's
JSR imports without Vite bundling its own configuration.

`serve.ts` serves the generated `_fresh/server.js` while preserving
`PMAI_SERVER_HOST` and `PORT`. SQL migrations are copied into the server build;
deploy the whole `_fresh/` directory alongside `serve.ts` and the Deno workspace
configuration/lockfile. Production registers `companion-maintenance` with
`Deno.cron` every minute, before starting HTTP. The workspace enables Deno's
`cron` feature. Vite development does not register the production cron.

## Deno Deploy

Configure from the repository root (the workspace includes shared packages):

- Install: `deno install`
- Build: `deno task --cwd apps/server build`
- Runtime entrypoint: `apps/server/serve.ts` (or the `apps/server` start task)
- Database: attach PostgreSQL 15+ or set `DATABASE_URL` in the target
  environment.
- Authentication: set a random `PMAI_DEV_AUTH_SECRET` of at least 32 characters.
- Optional: set `PMAI_PUBLIC_URL` to the deployment's HTTPS origin.

Deploy the server, then restart updated agents and update desktop/mobile
clients. Migration `003_http_sync` is additive and runs at startup. Agents
should set `PMAI_SERVER_URL=https://promptwaypoint.com`; the updated agent also
translates an existing `wss://<host>/ws/agent` setting to the HTTPS endpoints.
Old agent binaries and old SSE clients must be updated: `/ws/agent` and
`/api/events` are removed. Avoid serving mixed old/new server versions during
this protocol upgrade.

Verify `/health`, pairing, and an agent's online state. In Deploy's Cron tab,
verify that `companion-maintenance` is registered. Cron retries persisted push
jobs even without active clients; provider configuration is needed to actually
send notifications. Background scheduling of agent tasks does not depend on
cron. No live Deno Deploy account or paid provider execution is exercised by
tests.

See [Deploy runtime](https://docs.deno.com/deploy/reference/runtime/),
[PostgreSQL setup](https://docs.deno.com/deploy/reference/databases/), and
[Cron registration](https://docs.deno.com/deploy/reference/cron/).

## MCP integration

`/mcp` adds the official MCP SDK v2 Streamable HTTP transport beside the API.
The shared factory in `packages/mcp` is also used by the Deno stdio launcher in
`apps/mcp`. Authentication reuses `AuthProvider`; every request binds operations
to the authenticated user. OAuth linking/discovery is not yet implemented.

Task batch creation is an additive `POST /api/tasks/batch` operation, also
exposed by `ServerClient.createTasks`. It requires `Idempotency-Key`, validates
1–50 inputs, generates task IDs inside the existing mutation transaction,
preserves input order and prompts, then uses the existing dependency DAG checks.
Any failure rolls back the batch. No creation path authorizes execution.
Optional `origin` and `executionMode` fields live in the Task JSON body,
requiring no schema migration. Existing create/edit/action endpoints remain
compatible.

MCP imposes 120 requests/minute and 10 creation calls/minute per user in the
each server instance, with a bounded in-memory limiter and the existing 1 MB
request body limit. Tool handlers never query PostgreSQL directly. MCP-owned
resources are closed with the existing control-plane lifecycle, including Vite
reloads. Persistent MCP subscriptions are not enabled.

See [MCP setup and tools](../mcp/README.md) for all tool/resource schemas,
mutationId retry semantics, Claude Code configuration, remote smoke tests,
Prompt Waypoint authentication and ChatGPT OAuth limitations. No MCP-specific
secrets or new server auth environment variables are required.

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
4. Configure the agent's `PMAI_SERVER_URL=https://promptwaypoint.com` and
   `PMAI_DEVICE_TOKEN` using that response. Repository/profile metadata comes
   from the agent's authenticated registration, not from the mobile client.
5. POST `/api/devices/:id/token` rotates a token; DELETE on the same path
   revokes it and invalidates its active sync session. A lost pairing response
   can be recovered by rotating the token. These secret-issuing responses are
   deliberately not stored in the mutation journal.

Only SHA-256 hashes of high-entropy client/device tokens are persisted. Client
credentials expire after 30 days; device credentials after 365 days. Revocation
is checked on every HTTP request, and again inside the fenced agent transaction.
Logout revokes the current client token. Subsequent revision checks reject the
revoked token and the client subscription stops.

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
and runtime request schemas with the server. Desktop and mobile share its
revision polling and snapshot cache.

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
| GET `/api/revision`                                                                                     | Authenticated user-scoped revision, including presence/observation expiry   |
| POST `/api/agent/connect`, `/api/agent/sync`                                                            | Device token required; fenced registration and sync batches                 |

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
  scheduler dispatches only when the device has a fresh database heartbeat and
  has finished replaying its outbox, dependencies completed, a provider profile
  exists and the repository has no unfinished execution or freshly observed
  active external session.
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

## HTTPS synchronization and revisions

The local agent owns the polling loop; the server has no background scheduling
timer and no process-local presence or subscription registry. Any HTTP request
can reach any server instance sharing the same PostgreSQL database.

1. `POST /api/agent/connect` uses a device Bearer token and
   `{sessionId, generation, device, repositories, profiles}`. The agent persists
   an increasing generation per server origin in its SQLite metadata. The server
   records the current generation, session ID and token hash. Handshake retries
   with the same identity are idempotent; older generations and sessions are
   rejected even across instances. Rotating the device token resets this fence,
   allowing recovery after restoring an old agent database.
2. `POST /api/agent/sync` sends `{sessionId, events, hasMore, acknowledged}`.
   Under the user's transaction lock it rechecks auth/session ownership, renews
   presence, applies deduplicated events, records command ACKs, schedules queued
   work and returns
   `{sessionId, eventIds, acknowledged, commands, pollAfterMs}`. ACKs do not
   mean the execution completed. Event IDs are acknowledged only after the whole
   transaction commits. Invalid batches roll back completely.
3. The agent removes only acknowledged events from its durable outbox. Batches
   contain at most 100 events/ACKs and responses at most 20 commands. While
   `hasMore` is true the device is excluded from scheduling and command
   delivery. The normal poll interval is four seconds; new local events trigger
   an earlier request. Failures use exponential backoff up to a minute. Provider
   dispatch runs independently so a slow provider cannot block heartbeats.
4. Unfinished commands can be redelivered after 30 seconds with their original
   immutable IDs. The local journal prevents a second execution. Lost responses,
   instance restarts and concurrent sync calls preserve the same durable work.
   An agent receiving 401/403/409 stops syncing until pairing/restart is
   resolved.

A device is online while its authenticated heartbeat is less than 45 seconds
old. Presence expiry, token expiry and session freshness use database time.
Every domain change increments a user revision in its transaction. Identical
upserts and heartbeat timestamps do not force a full snapshot download.
`GET /api/revision` also incorporates presence and session expiry, so UI state
becomes stale without requiring a background process to update the database.

Desktop/mobile check revisions every four seconds. `ServerClient.snapshot()`
reuses the last snapshot if its revision is unchanged. Returning to the
foreground refreshes immediately. Session observations older than 120 seconds,
or belonging to offline devices, report `unknown`; online status never proves
work is running.

The scheduler runs during sync and awaited client mutations. Existing user
transaction locks and task execution constraints serialize competing instances.
Push retries run through production cron using the durable database queue. MCP
rate limits remain per instance, not a global quota. Mutation/event journals and
history do not yet have retention compaction or list pagination.

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
revision checks and real agent HTTPS synchronization.

Tests cover offline create/queue, concurrent Run, duplicate mutations,
dependency cycles, command transaction rollback, restart persistence, same
names/IDs across devices, stale sessions, tenant isolation, revoked tokens,
event validation, retained history, push envelopes, revision cancellation and a
real Fresh-to-Local-Agent HTTP session with retries. Cross-instance tests cover
shared presence, queue progression, stale-session fencing, lost-response
redelivery, revocation and atomic batch rollback. Provider execution uses the
Fake provider.
