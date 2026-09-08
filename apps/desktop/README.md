# Companion Desktop

Task-first local control UI built with Tauri 2, Preact, TypeScript, Tailwind CSS
and Deno. Start the Local Agent separately; Desktop does not launch or supervise
provider processes.

## Run

From the repository root:

```sh
deno install
deno task agent
```

In another terminal:

```sh
cd apps/desktop
deno task tauri dev
```

The packaged app reads the Companion Local Agent token from
`~/.pmai-agent/local-token`. Custom Companion tokens can be set in Settings and
are stored in macOS Keychain, Windows Credential Manager, or Linux Secret
Service. Provider credentials are neither read nor displayed. Add repositories
and already authenticated provider config directories in Settings, then select a
default profile for each repository.

`deno task dev` opens a browser development server at `http://127.0.0.1:1420`.
Its authenticated localhost proxy supports the default Agent address. Enter the
Companion Agent token in Settings for browser previews; preview tokens exist
only in memory and disappear on reload. Custom Agent addresses work in the
packaged app; browser previews additionally require an explicitly allowed Agent
origin.

Server connection is optional. Enter the server URL and Companion user token in
Settings, and configure the Agent's server connection separately as described in
`../agent/README.md`. Server downtime leaves local tasks and local Run/Resume
available. Repositories on other devices require a server connection.

## Working with tasks

- Inbox captures ideas; Projects groups tasks by their observed execution state.
- New Task opens a large multiline prompt editor. Save to Inbox, Mark Ready, Run
  Now and Run After Current preserve the full prompt.
- `Cmd/Ctrl+N` opens the editor; `Cmd/Ctrl+Enter` saves it. `Alt+Up/Down`
  reorders focused task cards within their repository.
- `Cmd/Ctrl+Shift+Space` opens the separate Quick Capture window globally.
- Closing either window hides it. Use the tray/menu bar to reopen the app,
  capture a task, or explicitly quit. Local queues advance while the main app is
  running, including while hidden; quitting stops desktop queue scheduling.
- Execution details expose provider-supported reply, resume and stop controls.
  External sessions stay separate and do not automatically create tasks.

One controller owns realtime subscriptions and a timed reconciliation fallback
per window. Actual execution state comes from the Agent. Task drafts, queue
order, cached metadata, and stable pending command IDs are persisted on the
device. Command submission is serialized across windows and the Agent also
rejects competing executions for the same task. Uncertain delivery retains the
original command ID; use Retry pending delivery instead of creating another run.

Cloud mutations have a durable revision journal and are retried with the same
idempotency key. Once Desktop explicitly uploads a task, server reconciliation
can adopt its observed local execution. An execution or external session alone
never creates a cloud task. Editing active tasks is blocked; existing tasks stay
in their original repository.

The Rust layer only handles windows, tray, shortcut, autostart, notifications
and Companion authentication storage. Shared presentation primitives live in
`packages/ui`; orchestration lives in `src/model/controller.ts`.

## Validation

From the repository root:

```sh
deno fmt
deno lint
deno check
deno task test
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
```

The integration runner starts and removes a disposable PostgreSQL instance. Set
`PMAI_TEST_DATABASE_URL` to a disposable database instead when running
`deno task
test` directly. Without it, PostgreSQL integration tests are
explicitly skipped. Desktop controller and rendered UI tests use fake providers,
including offline, unknown, waiting, unsupported capability and double-click
scenarios.

```sh
cd apps/desktop
deno task tauri build
```

macOS bundles are generated under `src-tauri/target/release/bundle/`. Native
shortcut, notification permission, autostart and credential-store behavior
should also be smoke-tested on each target operating system. Provider tests use
local fixtures and do not submit work to live Codex or Claude accounts.
