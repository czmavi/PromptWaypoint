import { useEffect, useState } from "preact/hooks";
import {
  DeviceStatus,
  ProviderBadge,
  StatusBadge,
  TaskCard,
  TaskPrompt,
} from "../../../packages/ui/main.ts";
import {
  DEFAULT_SERVER_URL,
  type TaskStatus,
} from "../../../packages/core/main.ts";
import { MobileController } from "./model/controller.ts";
import { type Destination } from "./model/navigation.ts";
import { Capture } from "./components/Capture.tsx";
import { TaskDetail } from "./components/TaskDetail.tsx";
import {
  clearAuth,
  connect,
  createController,
  enablePush,
  native,
  readAuth,
  renewAuth,
  setupNative,
} from "./native.ts";
const groups: [string, TaskStatus[]][] = [
  ["Running", ["dispatching", "running"]],
  ["Waiting", ["waiting_input", "waiting_quota", "unknown"]],
  ["Ready", ["ready", "queued"]],
  ["Inbox", ["inbox"]],
  ["Done", ["completed", "failed"]],
];
export default function App(
  { controller: provided }: { controller?: MobileController },
) {
  const [c, setController] = useState(provided);
  const [, render] = useState(0);
  const [tab, setTab] = useState("Home");
  const [repository, setRepository] = useState("");
  const [filter, setFilter] = useState("");
  const [capture, setCapture] = useState(false);
  const [editing, setEditing] = useState(false);
  const [destination, setDestination] = useState<Destination>();
  const [loading, setLoading] = useState(!provided);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    if (!provided) {
      void readAuth().then(async (auth) => {
        if (auth && !disposed) setController(await createController(auth));
      }).catch((e) => setError(String(e))).finally(() => setLoading(false));
    }
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!c) return;
    let disposed = false;
    let cleanupNative = () => {};
    const change = () => render((n) => n + 1);
    c.listeners.add(change);
    void c.start();
    void setupNative(c, setDestination).then((cleanup) => {
      if (disposed) cleanup();
      else cleanupNative = cleanup;
    }).catch((e) => setError(`Native integration: ${String(e)}`));
    const online = () => void c.sync();
    const visible = () => {
      if (document.visibilityState === "visible") void c.sync();
    };
    globalThis.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      c.stop();
      c.listeners.delete(change);
      cleanupNative();
      globalThis.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [c]);
  const perform = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (loading) {
    return (
      <main class="welcome">
        <span class="brand-mark" aria-hidden="true">PW</span>
        <h1>Prompt Waypoint</h1>
        <p>Opening your workspace…</p>
      </main>
    );
  }
  if (!c) {
    return (
      <main class="welcome">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">PW</span>Prompt Waypoint
        </div>
        <span class="eyebrow">YOUR AGENTS. WITH YOU.</span>
        <h1>
          Good ideas don’t wait<br />for your desk.
        </h1>
        <p>Capture tasks and keep your agents moving, wherever you are.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void perform(async () =>
              setController(
                await connect({
                  url: String(d.get("url")),
                  token: String(d.get("token")),
                }),
              )
            );
          }}
        >
          <label>
            Prompt Waypoint server<input
              name="url"
              type="url"
              required
              defaultValue={DEFAULT_SERVER_URL}
              placeholder={DEFAULT_SERVER_URL}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <label>
            Prompt Waypoint access token<input
              name="token"
              type="password"
              required
              placeholder="Your Prompt Waypoint token"
              autoComplete="off"
            />
          </label>
          <button type="submit" class="primary" disabled={busy}>
            {busy ? "Connecting…" : "Connect to workspace →"}
          </button>
        </form>
        {error && <p role="alert" class="error">{error}</p>}
        <small>
          {native
            ? "Your Prompt Waypoint token stays in this phone’s secure storage."
            : "Browser preview: your token is kept in memory for this session."}
        </small>
      </main>
    );
  }
  const selected = destination?.kind === "task"
    ? c.task(destination.id)
    : undefined;
  const session = destination?.kind === "session"
    ? c.snapshot.sessions.filter((s) =>
      s.id === destination.id &&
      (!destination.deviceId || s.deviceId === destination.deviceId) &&
      (!destination.providerProfileId ||
        s.providerProfileId === destination.providerProfileId)
    )
    : [];
  const openTask = (id: string) => {
    setDestination({ kind: "task", id });
    setCapture(false);
    setEditing(false);
  };
  if (capture) {
    return (
      <main class="mobile-shell">
        <Capture
          controller={c}
          task={editing ? selected : undefined}
          initial={{ repositoryId: repository || undefined }}
          onDone={openTask}
          onCancel={() => {
            setCapture(false);
            setEditing(false);
          }}
        />
      </main>
    );
  }
  const counts = (states: string[]) =>
    c.tasks.filter((t) => states.includes(t.status)).length;
  const visible = c.tasks.filter((t) =>
    (!repository || t.repositoryId === repository) &&
    (!filter || groups.find((g) => g[0] === filter)?.[1].includes(t.status))
  );
  const list = (tasks: typeof c.tasks) => (
    <div class="task-list">
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          title={t.title}
          status={t.status}
          onSelect={() => openTask(t.id)}
        >
          <span>{c.repository(t)?.name}</span>
          <ProviderBadge
            provider={c.profile(t)?.provider}
            name={c.profile(t)?.name ?? "Default"}
          />
          {c.pending(t.id).length > 0 && <small>Sync pending</small>}
        </TaskCard>
      ))}
    </div>
  );
  return (
    <div class="mobile-shell">
      <div class={`sync-bar ${c.online ? "synced" : ""}`} role="status">
        {c.online ? "● Workspace connected" : "○ Offline · showing saved data"}
        {c.data.mutations.length > 0 && (
          <span>{c.data.mutations.length} pending</span>
        )}
        <button
          type="button"
          onClick={() => void c.sync()}
          aria-label="Sync workspace"
        >
          ↻
        </button>
      </div>
      {destination
        ? selected
          ? (
            <TaskDetail
              controller={c}
              task={selected}
              onBack={() => setDestination(undefined)}
              onEdit={() => {
                setEditing(true);
                setCapture(true);
              }}
              onSession={() => {
                const s = c.session(selected.id);
                if (s) {
                  setDestination({
                    kind: "session",
                    id: s.id,
                    deviceId: s.deviceId,
                    providerProfileId: s.providerProfileId,
                  });
                }
              }}
            />
          )
          : destination.kind === "session"
          ? (
            <article class="session-detail">
              <header class="screen-header">
                <button type="button" onClick={() => setDestination(undefined)}>
                  ← Back
                </button>
                <strong>Session detail</strong>
              </header>
              {session.length === 1
                ? (
                  <div class="detail-body">
                    <StatusBadge status={session[0].state} />
                    <h1>
                      {session[0].origin === "external"
                        ? "External session"
                        : "Execution session"}
                    </h1>
                    <ProviderBadge
                      provider={session[0].provider}
                      name={c.snapshot.profiles.find((p) =>
                        p.id === session[0].providerProfileId &&
                        p.deviceId === session[0].deviceId
                      )?.name}
                    />
                    <p>
                      {c.snapshot.repositories.find((r) =>
                        r.id === session[0].repositoryId
                      )?.name ?? "Repository unavailable"}
                    </p>
                    <p>
                      {c.snapshot.devices.find((d) =>
                        d.id === session[0].deviceId
                      )?.name}
                    </p>
                    <TaskPrompt
                      prompt={session[0].lastMessage ??
                        "No assistant message available"}
                    />
                    <p>
                      Updated {new Date(session[0].updatedAt).toLocaleString()}
                    </p>
                    {session[0].stale && (
                      <p class="hint">
                        Cached session · refresh to confirm its state.
                      </p>
                    )}
                    {session[0].taskId && (
                      <button
                        type="button"
                        class="primary"
                        onClick={() => openTask(session[0].taskId!)}
                      >
                        Open associated task
                      </button>
                    )}
                  </div>
                )
                : (
                  <div class="empty">
                    <h2>
                      {session.length
                        ? "Choose the associated task"
                        : "Session not available in the latest snapshot"}
                    </h2>
                    <button
                      type="button"
                      onClick={() => void c.sync()}
                    >
                      Refresh
                    </button>
                  </div>
                )}
            </article>
          )
          : (
            <section class="empty">
              <h1>Task unavailable</h1>
              <p>Reconnect to refresh this notification’s task.</p>
              <button type="button" onClick={() => void c.sync()}>Retry</button>
              <button type="button" onClick={() => setDestination(undefined)}>
                Back to Home
              </button>
            </section>
          )
        : tab === "Settings"
        ? (
          <section class="page settings">
            <span class="eyebrow">PROMPT WAYPOINT</span>
            <h1>Settings</h1>
            <section class="setting-card">
              <h2>Notifications</h2>
              <p>
                Task completed, task failed, agent needs input and task resumed.
              </p>
              <button
                type="button"
                disabled={busy || !native}
                onClick={() => void perform(() => enablePush(c))}
              >
                {c.data.push
                  ? "Refresh push registration"
                  : "Enable push notifications"}
              </button>
              <small>
                {c.data.push
                  ? c.data.pushSynced === c.data.push.token
                    ? "Registered with server"
                    : "Registration sync pending"
                  : "Not registered"}
              </small>
            </section>
            <section class="setting-card">
              <h2>Connection & sync</h2>
              <p>
                {c.online
                  ? "Server online"
                  : "Offline — cached data is available"}
              </p>
              <small>
                Last sync: {c.data.lastSync
                  ? new Date(c.data.lastSync).toLocaleString()
                  : "Never"}
              </small>
              <button type="button" onClick={() => void c.sync()}>
                Sync now
              </button>
              {c.data.mutations.filter((m) => m.error).map((m) => (
                <div key={m.id}>
                  <p class="error">{m.error}</p>
                  <button
                    type="button"
                    onClick={() =>
                      void c.retry(m.id)}
                  >
                    Retry change
                  </button>
                  <button type="button" onClick={() => c.discard(m.id)}>
                    Discard rejected change
                  </button>
                </div>
              ))}
            </section>
            <section class="setting-card">
              <h2>Prompt Waypoint account</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const token = String(
                    new FormData(event.currentTarget).get("token") ?? "",
                  );
                  void perform(async () =>
                    setController(await renewAuth(c, token))
                  );
                }}
              >
                <label>
                  Renew Prompt Waypoint access token<input
                    name="token"
                    type="password"
                    required
                    autoComplete="off"
                    placeholder="New token for this workspace"
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Update access token
                </button>
              </form>
              <p>Provider accounts are managed on your computers.</p>
              <button
                type="button"
                disabled={busy || c.data.mutations.length > 0}
                onClick={() =>
                  void perform(async () => {
                    if (c.data.push) {
                      await c.api.removePush(
                        c.data.push.id,
                        crypto.randomUUID(),
                      );
                    }
                    await clearAuth();
                    c.stop();
                    c.store.clear();
                    setController(undefined);
                    setDestination(undefined);
                  })}
              >
                Disconnect & clear this phone’s cache
              </button>
              {c.data.mutations.length > 0 && (
                <small>
                  Sync or resolve pending changes before disconnecting.
                </small>
              )}
            </section>
            {error && <p role="alert" class="error">{error}</p>}
          </section>
        )
        : tab === "Devices"
        ? (
          <section class="page">
            <span class="eyebrow">YOUR WORKSPACE</span>
            <h1>Devices</h1>
            <p class="subtitle">A quick check on every computer.</p>
            {c.snapshot.devices.map((d) => (
              <section class="device-card" key={d.id}>
                <DeviceStatus name={d.name} online={d.online} />
                <p class="device-seen">
                  {d.online
                    ? "Online now"
                    : `Last seen ${
                      d.lastSeenAt
                        ? new Date(d.lastSeenAt).toLocaleString()
                        : "unknown"
                    }`}
                </p>
                {c.snapshot.repositories.filter((r) =>
                  r.deviceId === d.id
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRepository(r.id);
                      setTab("Projects");
                      setFilter("");
                    }}
                  >
                    {r.name}
                    <span>→</span>
                  </button>
                ))}
              </section>
            ))}
          </section>
        )
        : (
          <section class="page">
            <header class="mobile-heading">
              <div>
                <span class="eyebrow">
                  {repository
                    ? "PROJECT"
                    : tab === "Home"
                    ? "A LITTLE MOMENTUM"
                    : "YOUR WORKSPACE"}
                </span>
                <h1>
                  {repository
                    ? c.snapshot.repositories.find((r) => r.id === repository)
                      ?.name
                    : tab === "Home"
                    ? "Your work, in motion."
                    : "Projects"}
                </h1>
              </div>
              <button
                type="button"
                class="capture-circle"
                aria-label="New Task"
                onClick={() => {
                  setEditing(false);
                  setCapture(true);
                }}
              >
                ＋
              </button>
            </header>
            {!repository && tab === "Home" && (
              <>
                <p class="subtitle">
                  Check in. Add an idea. Keep things moving.
                </p>
                <button
                  type="button"
                  class="primary capture-hero"
                  onClick={() => setCapture(true)}
                >
                  <span>＋ New Task</span>
                  <span>Capture what’s next ↗</span>
                </button>
                <div class="counts">
                  {groups.slice(0, 3).map(([name, states]) => (
                    <button
                      type="button"
                      key={name}
                      class={filter === name ? "selected" : ""}
                      onClick={() => setFilter(filter === name ? "" : name)}
                    >
                      <strong>{counts(states)}</strong>
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
                <div class="section-heading">
                  <h2>Devices</h2>
                  <button
                    type="button"
                    class="text-button"
                    onClick={() => setTab("Devices")}
                  >
                    View all →
                  </button>
                </div>
                <div class="device-strip">
                  {c.snapshot.devices.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setTab("Devices")}
                    >
                      <DeviceStatus name={d.name} online={d.online} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === "Projects" && !repository
              ? c.snapshot.devices.map((d) => (
                <section class="project-group" key={d.id}>
                  <h2>
                    <DeviceStatus name={d.name} online={d.online} />
                  </h2>
                  {c.snapshot.repositories.filter((r) =>
                    r.deviceId === d.id
                  ).map((r) => (
                    <button
                      type="button"
                      class="repository-card"
                      key={r.id}
                      onClick={() => {
                        setRepository(r.id);
                        setFilter("");
                      }}
                    >
                      <span class="repository-icon">{r.name.slice(0, 1)}</span>
                      <strong>
                        {r.name}
                        <small>
                          {c.tasks.filter((t) => t.repositoryId === r.id)
                            .length} tasks
                        </small>
                      </strong>
                      <span>→</span>
                    </button>
                  ))}
                </section>
              ))
              : (
                <>
                  {repository && (
                    <>
                      <button
                        type="button"
                        class="text-button"
                        onClick={() => setRepository("")}
                      >
                        ← All projects
                      </button>
                      <div class="filters">
                        {groups.map(([name, states]) => (
                          <button
                            type="button"
                            key={name}
                            class={filter === name ? "selected" : ""}
                            onClick={() =>
                              setFilter(filter === name ? "" : name)}
                          >
                            {name}{" "}
                            <small>
                              {c.tasks.filter((t) =>
                                t.repositoryId === repository &&
                                states.includes(t.status)
                              ).length}
                            </small>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div class="section-heading">
                    <h2>{filter || "Your tasks"}</h2>
                    <small>{visible.length} tasks</small>
                  </div>
                  {visible.length
                    ? groups.map(([name, states]) => {
                      const tasks = visible.filter((t) =>
                        states.includes(t.status)
                      );
                      return tasks.length > 0 && (
                        <section class="task-group" key={name}>
                          <h3>
                            {name}
                            <span>{tasks.length}</span>
                          </h3>
                          {list(tasks)}
                        </section>
                      );
                    })
                    : (
                      <div class="empty">
                        <span>▱</span>
                        <h2>
                          {c.snapshot.repositories.length
                            ? "A little space for your next idea"
                            : "Your workspace starts here"}
                        </h2>
                        <p>
                          {c.snapshot.repositories.length
                            ? "Save a task with a clear prompt. Pick it up on any device."
                            : "Add a repository on your desktop, then sync your phone."}
                        </p>
                        <button type="button" onClick={() => setCapture(true)}>
                          ＋ New Task
                        </button>
                      </div>
                    )}
                </>
              )}
          </section>
        )}
      {!destination && (
        <nav class="bottom-nav" aria-label="Mobile navigation">
          {[["Home", "⌂"], ["Projects", "▦"], ["Devices", "▣"], [
            "Settings",
            "⚙",
          ]].map(([name, icon]) => (
            <button
              type="button"
              key={name}
              class={tab === name ? "active" : ""}
              onClick={() => {
                setTab(name);
                setRepository("");
                setFilter("");
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
