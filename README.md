# Prompt Waypoint

Prompt Waypoint manages coding tasks across local repositories, computers, and
AI coding providers. Write a focused prompt, choose a repository, and run it
through an authenticated Codex or Claude Code profile on your computer.

A task is **one prompt for one repository**. Saving a task does not execute it:
**Run**, **Queue**, and **Resume** are explicit actions.

## Choose your setup

| Setup                                         | Components you need                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Work on one computer                          | Local Agent and Desktop                                                                                   |
| Manage tasks from a phone or another computer | Local Agent, Desktop or Mobile, and an authenticated server connection                                    |
| Manage tasks from an MCP-compatible AI client | A server, a Prompt Waypoint client token, and the MCP integration; a paired Local Agent executes the work |

The default server address is `https://promptwaypoint.com`. A valid Prompt
Waypoint client token is required to connect; the URL alone does not grant
access. You can also run your own server. Local desktop use does not require a
server or PostgreSQL.

## Requirements

- **Deno 2.9+**, including `node:sqlite` support.
- **Codex CLI and/or Claude Code**, installed and authenticated on the computer
  that will execute tasks. Authenticate with the provider's own tools before
  adding its profile to Prompt Waypoint.
- **Rust/Cargo and the platform build tools required by Tauri 2** for native
  desktop builds. The browser preview does not require a native build.
- **PostgreSQL 15+** only when running your own server.
- For native mobile builds: **Xcode** on macOS for iOS, or **JDK 17, Android
  SDK, and NDK** for Android. See the [mobile guide](apps/mobile/README.md).

The commands below run from the repository root unless stated otherwise.

## Quick start: local desktop

### 1. Install dependencies

Open a terminal in your checkout of this repository:

```sh
deno install
```

### 2. Start the Local Agent

```sh
deno task agent
```

Keep this terminal running. The agent listens on `http://127.0.0.1:7431` and
stores its state in `~/.pmai-agent`. It creates its local API token in
`~/.pmai-agent/local-token` on first start.

### 3. Start Desktop

In a second terminal:

```sh
deno task --cwd apps/desktop tauri dev
```

The native app reads the default Local Agent token automatically. Desktop does
not start the agent itself, so both processes must remain running.

For a browser preview instead:

```sh
deno task desktop
```

Open `http://127.0.0.1:1420` and enter the contents of
`~/.pmai-agent/local-token` in **Settings → Local Agent & Server → Prompt
Waypoint Agent token**. Browser preview tokens are kept in memory and must be
entered again after a reload.

### 4. Add a repository and provider profile

In **Settings**:

1. Under **Repositories**, enter a name and an absolute path to an existing
   local repository, then select **Add repository**.
2. Under **Provider Profiles**, select **Codex** or **Claude**, enter a profile
   name and the absolute path to its already authenticated local configuration
   directory, then select **Add profile**.
3. Select that profile as the repository's default provider profile.

Use the configuration directory associated with the provider account you want
running the work. Provider processes and credentials stay on the Local Agent's
computer.

### 5. Create and run your first task

1. Open **New Task** or press **Cmd/Ctrl+N**.
2. Choose the repository, enter a title, and write the full instructions in the
   multiline prompt editor. For example:

   ```text
   Review this repository's setup instructions and update the documentation
   with any missing installation steps. Verify the documented commands.
   ```

3. Choose **Save to Inbox** to capture the idea, **Mark Ready** to prepare it,
   or **Run Now** to start execution.
4. Open the task's execution details to follow its state and use the available
   reply, resume, or stop controls.

## Everyday use

| Action                     | What it does                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Save to Inbox              | Saves a task without executing it.                                                               |
| Mark Ready / Move to Ready | Keeps a task ready for a later execution decision.                                               |
| Run Now / Run              | Starts a new execution when the device and provider are available and dependencies are complete. |
| Run After Current / Queue  | Authorizes automatic execution once the task becomes eligible.                                   |
| Resume                     | Continues a supported existing, inactive session.                                                |
| Send prompt / reply        | Supplies additional text to a supported session, including one waiting for input.                |
| Stop                       | Interrupts a supported active execution.                                                         |

Dependencies must belong to the same repository and cannot form a cycle. A
completed execution needs a new **Run** for new work. Sessions discovered from
outside Prompt Waypoint remain separate until explicitly addressed; discovery
alone does not create a task.

Local queues advance while Desktop is running, including while its window is
hidden. Closing a window hides it; quitting the app stops desktop queue
scheduling. Use the tray/menu bar to reopen the app or quit explicitly. Server
queues also require the execution computer and its Local Agent to be available
before work can run.

Useful desktop shortcuts:

| Shortcut             | Action                                         |
| -------------------- | ---------------------------------------------- |
| Cmd/Ctrl+N           | Open New Task                                  |
| Cmd/Ctrl+Enter       | Save in the task editor                        |
| Alt+Up / Alt+Down    | Reorder focused task cards within a repository |
| Cmd/Ctrl+Shift+Space | Open the global Quick Capture window           |

If delivery is uncertain, use **Retry pending delivery**. It preserves the
original command identity and avoids submitting a second execution.

## Connect a server and mobile client

Desktop can work locally, but Mobile and cross-device access use the server. The
server's `/` page is a public product website; task management happens in the
clients or through MCP.

### Pair an execution computer

You need a **client token** for Desktop/Mobile/MCP and a separate **device
token** for each Local Agent. They are distinct from the agent's local API token
and from provider credentials.

1. Obtain a client token from the server administrator, or use the configured
   bootstrap login on your own server as described below.
2. Read the running agent's persistent device identity from its authenticated
   `GET http://127.0.0.1:7431/state` endpoint, using the local API token as a
   Bearer token.
3. With the server client token, send `POST /api/devices` containing the agent's
   `{ "id": "…", "name": "…", "platform": "…" }`. Save the returned device
   token; it is returned only once.
4. Stop the agent and restart it with its server connection configured:

   ```sh
   export PMAI_SERVER_URL="https://promptwaypoint.com"
   # Set PMAI_DEVICE_TOKEN to the device token using your secret manager or environment.
   deno task agent
   ```

5. In Desktop **Settings → Local Agent & Server**, set the server URL and
   **Prompt Waypoint Server token** to the client token. Verify that the device
   appears online.

The agent requires an **HTTPS server URL**, including when you host the server
locally. Without `PMAI_DEVICE_TOKEN`, it stays local. See
[authentication and device pairing](apps/server/README.md#authentication-and-device-pairing)
for the complete API flow and token rotation.

### Open Mobile

For a browser preview:

```sh
deno task mobile
```

Open `http://localhost:1430`, then connect with the same server URL and client
token. For browser testing, the server must allow that exact origin through
`PMAI_CORS_ORIGINS`.

Mobile's **Home** shows task and device state. **Projects** groups repositories
by computer; open a repository to capture tasks or use the supported execution
controls. Drafts and pending changes persist offline and synchronize after
reconnection. Execution still requires an available computer running the agent.

A physical phone needs an HTTPS server reachable from the phone; `localhost`
refers to the phone itself. Native builds, secure token storage, notification
setup, and release instructions are in the
[mobile guide](apps/mobile/README.md).

## Run your own server

Create an empty PostgreSQL application database and provide its connection
string through the environment. For local development:

```sh
export DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/prompt_waypoint"
# Optional: set PMAI_DEV_AUTH_SECRET to a random secret of at least 32 characters.
export PMAI_CORS_ORIGINS="http://127.0.0.1:1420,http://localhost:1430"
deno task server
```

Replace the database placeholders with your own values. The development server
listens on `http://127.0.0.1:8000` and applies database migrations on runtime
initialization. Check `http://127.0.0.1:8000/health` for database connectivity.

To obtain a client token with the bundled bootstrap login, set
`PMAI_DEV_AUTH_SECRET` before starting the server, then send
`POST /api/auth/dev-login` with `{ "secret": "<configured secret>" }`. The
response contains `token` and `user`. Login is disabled when the secret is
unset; there is no default password.

Local browser/API testing can use the HTTP address. Set up HTTPS before pairing
an agent or connecting remotely. `PMAI_SERVER_URL` selects the server used by
Agent/MCP; Desktop and Mobile have their own server URL settings.

For a production build:

```sh
deno task --cwd apps/server build
deno task --cwd apps/server start
```

See the [server guide](apps/server/README.md) for deployment, authentication,
additional environment variables, migrations, and push notifications.

## Use an AI client through MCP

MCP lets a compatible AI client list repositories, create and edit tasks, define
dependencies, and explicitly run, queue, resume, or stop supported work.
Creating tasks through MCP does not execute them.

For a local stdio integration, configure the host to launch the following from
this repository with `PMAI_CLIENT_TOKEN` set to your server client token:

```sh
deno task mcp
```

`PMAI_SERVER_URL` defaults to `https://promptwaypoint.com`. A host supporting
remote Streamable HTTP can instead connect to `https://promptwaypoint.com/mcp`
with `Authorization: Bearer <Prompt Waypoint client token>`.

To check the configured server without changing tasks:

```sh
deno task mcp:smoke
```

See the [MCP guide](apps/mcp/README.md) for host configuration, available tools,
resources, and retry rules. Hosts requiring OAuth account linking are not yet
supported by this server.

## Troubleshooting

| Problem                             | What to check                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop cannot connect to the agent | Start `deno task agent`, check port `7431`, and verify the local API token in Settings. Browser previews require manual token entry.                                                             |
| A provider is unavailable           | Verify that its executable is installed and authenticated, and that the profile points to the correct local config directory. Custom executable paths use `PMAI_CODEX_BIN` or `PMAI_CLAUDE_BIN`. |
| A device is offline on Mobile       | Keep the computer and agent running; check the HTTPS server URL and device token. Configuring Desktop's server connection does not pair the agent.                                               |
| A task does not start               | Confirm it was explicitly run or queued, its dependencies are complete, its repository path is available, and its provider is available. Keep Desktop running for local queues.                  |
| The browser reports a CORS error    | Add its exact origin, including port, to the server's `PMAI_CORS_ORIGINS`.                                                                                                                       |
| The server cannot start             | Check `DATABASE_URL`, database connectivity, and PostgreSQL version.                                                                                                                             |
| Authentication fails                | Use the correct token type. Client, device, local-agent, and provider credentials are not interchangeable. Renew expired or revoked tokens.                                                      |

Some controls depend on provider capabilities. External Claude sessions can have
unknown live state; exact Claude quota/reset reporting and interactive tool
approval responses are not implemented. See the
[Local Agent guide](apps/agent/README.md#provider-boundaries) for these limits.

## Project structure

| Path                                                            | Purpose                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/agent`                                                    | Local execution, provider profiles, session discovery, and synchronization           |
| `apps/desktop`                                                  | Native desktop client and browser development preview                                |
| `apps/mobile`                                                   | Native mobile client and browser development preview                                 |
| `apps/server`                                                   | Fresh/Vite API, PostgreSQL persistence, public website, MCP endpoint, and push relay |
| `apps/mcp`                                                      | Stdio MCP launcher and read-only remote smoke client                                 |
| `packages/mcp`                                                  | Shared MCP server, schemas, tools, and resources                                     |
| `packages/core`, `packages/protocol`, `packages/provider-types` | Shared domain types, validation, and provider contracts                              |
| `packages/api-client`, `packages/ui`                            | Typed clients and shared UI components                                               |

Existing `PMAI_*` environment variables, installation IDs, storage keys, and
`pmai://` links retain their names for compatibility.

## Development checks

```sh
deno fmt --check
deno lint
deno check
deno task test
deno task mcp:test
```

For the full integration suite, point the runner at your PostgreSQL binaries:

```sh
# Example path for PostgreSQL 15 installed with Homebrew on Apple Silicon:
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
```

The runner creates and removes a disposable PostgreSQL cluster. Ordinary test
commands skip database integration tests unless `PMAI_TEST_DATABASE_URL` is set.
Tests use fake providers and fixtures; they do not require paid provider calls
or validate live provider execution.

## License

[Apache License 2.0](LICENSE).
