# Prompt Waypoint Desktop

Task-first local control UI built with Tauri 2, Preact, TypeScript, Tailwind CSS
and Deno. The direct macOS download includes the Local Agent. Start it once in
**Settings → Local Agent & Server → Start Local Agent**; later launches can
start it automatically. Codex CLI / Claude Code still needs to be installed and
signed in. See [macOS distribution](DISTRIBUTION.md) for installation and signed
updates.

## Development

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

The packaged app reads the Prompt Waypoint Local Agent token from
`~/.pmai-agent/local-token`. Custom Prompt Waypoint tokens can be set in
Settings and are stored in macOS Keychain, Windows Credential Manager, or Linux
Secret Service. Provider credentials are neither read nor displayed. Add
repositories and already authenticated provider config directories in Settings,
then select a default profile for each repository.

Provider Profiles automatically asks the Local Agent to discover configuration
folders when Settings opens or the agent reconnects. **Add** imports a found
configuration, and **Scan again** refreshes the suggestions. Existing profiles
are excluded. Discovery checks the agent user's `~/.codex`, `~/.claude`, and the
agent process's `CODEX_HOME` / `CLAUDE_CONFIG_DIR` overrides. It resolves
symlinks and deduplicates by provider and directory; it never scans the whole
disk, reads credential contents, or verifies sign-in. Found folders are not
proof that a provider CLI is installed or authenticated. Custom directories can
also be selected with **Choose folder…** in the native app.

Update and restart the Local Agent along with the desktop app for profile
discovery. The authenticated `/profiles/discover` endpoint is local only;
configuration paths are not sent to the cloud server. Importing the same
provider/directory again returns its existing profile without changing its name
or Auto Resume setting. Newly discovered profiles start with Auto Resume
disabled.

Use **Choose folder…** under Repositories to select a project directory in the
system dialog. Its folder name becomes the editable repository name; the
selected path stays visible and **Change folder…** lets you replace it. Browser
previews retain manual path entry because browsers do not expose absolute local
directory paths. The Local Agent continues to access project files; the desktop
app only passes the selected path to it.

macOS uses a universal DMG for Apple Silicon and Intel, macOS 13.3+. Mac App
Store/TestFlight distribution is discontinued. The app checks for updates and
installs them with **Update and restart** once running work has stopped.

`deno task dev` opens a browser development server at `http://127.0.0.1:1420`.
Its authenticated localhost proxy supports the default Agent address. Enter the
Prompt Waypoint Agent token in Settings for browser previews; preview tokens
exist only in memory and disappear on reload. Custom Agent addresses work in the
packaged app; browser previews additionally require an explicitly allowed Agent
origin.

Server connection is optional. The default URL is `https://promptwaypoint.com`.
Enter a Prompt Waypoint user token in Settings, and configure the Agent's server
connection separately as described in `../agent/README.md`. Server downtime
leaves local tasks and local Run/Resume available. Repositories on other devices
require a server connection.

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

One controller owns local Agent events, server revision polling and a timed
reconciliation fallback per window. Full server snapshots are reused until the
database revision or freshness state changes. Returning to the foreground
refreshes immediately. Actual execution state comes from the Agent. Task drafts,
queue order, cached metadata, and stable pending command IDs are persisted on
the device. Command submission is serialized across windows and the Agent also
rejects competing executions for the same task. Uncertain delivery retains the
original command ID; use Retry pending delivery instead of creating another run.

Cloud mutations have a durable revision journal and are retried with the same
idempotency key. Once Desktop explicitly uploads a task, server reconciliation
can adopt its observed local execution. An execution or external session alone
never creates a cloud task. Editing active tasks is blocked; existing tasks stay
in their original repository.

The Rust layer only handles windows, tray, shortcut, autostart, folder
selection, notifications, Prompt Waypoint authentication storage, the bundled
agent lifecycle and signature-verified updates. Shared presentation primitives
live in `packages/ui`; orchestration lives in `src/model/controller.ts`.

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
deno task macos:build
```

macOS bundles are generated under
`src-tauri/target/universal-apple-darwin/release/bundle/`. Native shortcut,
notification permission, autostart and credential-store behavior should also be
smoke-tested on each target operating system. Provider tests use local fixtures
and do not submit work to live Codex or Claude accounts.
