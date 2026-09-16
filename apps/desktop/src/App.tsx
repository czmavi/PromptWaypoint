import { useEffect, useState } from "preact/hooks";
import {
  DeviceStatus,
  ProviderBadge,
  QuotaDisplay,
  StatusBadge,
  TaskCard,
  TaskPrompt,
} from "../../../packages/ui/main.ts";
import type { TaskStatus } from "../../../packages/core/main.ts";
import type { DesktopController } from "./model/controller.ts";
import { capture, hideCapture, makeController } from "./native.ts";
import { Editor } from "./components/Editor.tsx";
import { Settings } from "./components/Settings.tsx";
const nav = [
  "Inbox",
  "Projects",
  "Running",
  "Waiting",
  "Done",
  "Devices",
  "Settings",
];
export default function App(
  {
    controller: provided,
    quick = new URLSearchParams(location.search).has("capture"),
  }: { controller?: DesktopController; quick?: boolean },
) {
  const [c, setController] = useState(provided);
  const [, tick] = useState(0);
  const [view, setView] = useState("Inbox");
  const [repo, setRepository] = useState("");
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [captureVersion, setCaptureVersion] = useState(0);
  useEffect(() => {
    let cleanup = () => {};
    let disposed = false;
    void (provided ? Promise.resolve(provided) : makeController()).then(
      (controller) => {
        if (disposed) return;
        setController(controller);
        const update = () => tick((n) => n + 1);
        controller.listeners.add(update);
        document.documentElement.dataset.appearance =
          controller.preferences.appearance;
        void controller.start(!quick);
        const storage = () => {
          controller.changed();
          void controller.refresh();
        };
        globalThis.addEventListener("storage", storage);
        const visible = () => {
          if (document.visibilityState === "visible") void controller.refresh();
        };
        document.addEventListener("visibilitychange", visible);
        cleanup = () => {
          controller.stop();
          controller.listeners.delete(update);
          globalThis.removeEventListener("storage", storage);
          document.removeEventListener("visibilitychange", visible);
        };
      },
    ).catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setSelected("");
        setEditing(true);
      }
      if (e.key === "Escape") {
        setEditing(false);
        if (quick) void hideCapture();
      }
    };
    globalThis.addEventListener("keydown", key);
    return () => globalThis.removeEventListener("keydown", key);
  }, []);
  if (!c) {
    return <div class="loading">{error || "Opening Prompt Waypoint…"}</div>;
  }
  const execute = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const task = c.tasks.find((t) => t.id === selected);
  const session = c.sessions.find((s) =>
    JSON.stringify([s.deviceId, s.providerProfileId, s.id]) === sessionId
  );
  const count = (states: string[]) =>
    c.tasks.filter((t) => states.includes(t.status)).length;
  if (quick) {
    return (
      <main class="quick-capture">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">PW</span>Prompt Waypoint
          {" "}
          <small>Quick Capture</small>
        </div>
        <Editor
          controller={c}
          quick
          onClose={() => {
            setEditing(false);
            setSelected("");
            setCaptureVersion((n) => n + 1);
            void hideCapture();
          }}
          key={captureVersion}
        />
        {c.message && <p role="status">{c.message}</p>}
      </main>
    );
  }
  const filtered = c.tasks.filter((t) =>
    (!repo || t.repositoryId === repo) &&
    (view === "Projects" || view === "Inbox" && t.status === "inbox" ||
      view === "Running" && ["running", "dispatching"].includes(t.status) ||
      view === "Waiting" &&
        ["waiting_input", "waiting_quota", "unknown", "queued"].includes(
          t.status,
        ) ||
      view === "Done" && ["completed", "failed"].includes(t.status))
  );
  const statuses: TaskStatus[] = [
    "running",
    "dispatching",
    "waiting_input",
    "waiting_quota",
    "unknown",
    "queued",
    "ready",
    "inbox",
    "completed",
    "failed",
  ];
  const devices = new Map<
    string,
    { id: string; name: string; online: boolean; local: boolean }
  >(
    (c.cloud?.devices ?? []).map((d) => [d.id, { ...d, local: false }]),
  );
  if (c.local) {
    devices.set(
      c.local.device.id,
      { ...c.local.device, online: c.agentOnline, local: true },
    );
  }
  return (
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">PW</span>Prompt
          Waypoint<span class="edition">
            LOCAL
          </span>
        </div>
        <button
          type="button"
          class="new-task"
          onClick={() => {
            setSelected("");
            setEditing(true);
          }}
        >
          ＋ New task <kbd>⌘ N</kbd>
        </button>
        <nav>
          {nav.map((name, i) => (
            <button
              key={name}
              type="button"
              class={view === name && !repo ? "active" : ""}
              onClick={() => {
                setView(name);
                setRepository("");
                setSelected("");
                setSessionId("");
                setEditing(false);
              }}
            >
              <span aria-hidden="true">
                {["▱", "▦", "↗", "◷", "✓", "▣", "⚙"][i]}
              </span>
              {name}
              {name === "Inbox" && <small>{count(["inbox"])}</small>}
              {name === "Running" && (
                <small>{count(["running", "dispatching"])}</small>
              )}
            </button>
          ))}
        </nav>
        <div class="sidebar-label">
          PROJECTS <span>{c.repositories.length}</span>
        </div>
        {c.repositories.map((r) => (
          <button
            key={r.id}
            type="button"
            class={`project-link ${repo === r.id ? "active" : ""}`}
            onClick={() => {
              setRepository(r.id);
              setView("Projects");
              setSelected("");
              setEditing(false);
            }}
          >
            <span class="project-icon">{r.name.slice(0, 1).toUpperCase()}</span>
            {r.name}
          </button>
        ))}
        <div class="sidebar-bottom">
          <button type="button" onClick={() => void capture()}>
            ↗ Quick Capture <kbd>⇧ ⌘ Space</kbd>
          </button>
          <span class={`connection ${c.agentOnline ? "connected" : ""}`}>
            ● Local Agent {c.agentOnline ? "online" : "offline"}
          </span>
          <span class={`connection ${c.serverOnline ? "connected" : ""}`}>
            ● Server {c.serverOnline
              ? "online"
              : c.cloudApi
              ? "offline"
              : "not configured"}
          </span>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <span>
            Workspace <span class="slash">/</span>{" "}
            {repo ? c.repositories.find((r) => r.id === repo)?.name : view}
          </span>
          <button type="button" onClick={() => void execute(() => c.refresh())}>
            ↻ Refresh
          </button>
        </header>
        {(error || c.error) && (
          <div role="alert" class="error banner">
            {error || c.error}
            <button
              type="button"
              onClick={() => {
                setError("");
                c.error = "";
                c.changed();
              }}
            >
              Dismiss
            </button>
          </div>
        )}
        {c.message && <div class="toast" role="status">{c.message}</div>}
        {view === "Settings"
          ? <Settings controller={c} />
          : view === "Devices"
          ? (
            <div class="page">
              <h1>Devices</h1>
              <p class="muted">Your work, wherever your agents run.</p>
              {[...devices.values()].map((d) => (
                <section class="device-panel">
                  <h2>
                    <DeviceStatus
                      name={d.name}
                      online={d.online}
                      local={d.local}
                    />
                  </h2>
                  {c.repositories.filter((r) => r.deviceId === d.id).map(
                    (r) => (
                      <button
                        type="button"
                        onClick={() => {
                          setRepository(r.id);
                          setView("Projects");
                        }}
                      >
                        {r.name} →
                      </button>
                    ),
                  )}
                </section>
              ))}
              {!devices.size && (
                <p>Connect your Local Agent in Settings to see this device.</p>
              )}
            </div>
          )
          : (
            <div class="page">
              <div class="page-heading">
                <div>
                  <span class="eyebrow">YOUR WORKSPACE</span>
                  <h1>
                    {repo
                      ? c.repositories.find((r) => r.id === repo)?.name
                      : view === "Inbox"
                      ? "Make room for your next idea."
                      : view}
                  </h1>
                  <p class="muted">
                    {repo
                      ? "One place for the work you want to move forward."
                      : "Capture a thought. Give it context. Let your agents take it forward."}
                  </p>
                </div>
                <button
                  type="button"
                  class="primary"
                  onClick={() => {
                    setSelected("");
                    setEditing(true);
                  }}
                >
                  ＋ New task
                </button>
              </div>
              <div class="overview">
                {[["Running", count(["running", "dispatching"]), "↗"], [
                  "Waiting",
                  count(["waiting_input", "waiting_quota"]),
                  "◷",
                ], ["Ready", count(["ready"]), "○"]].map(([name, n, icon]) => (
                  <button
                    type="button"
                    onClick={() => {
                      setView(name === "Ready" ? "Projects" : String(name));
                      setRepository("");
                    }}
                  >
                    <span>{icon} {name}</span>
                    <strong>{n}</strong>
                  </button>
                ))}
                <div class="overview-devices">
                  {[...devices.values()].map((d) => (
                    <DeviceStatus
                      name={d.name}
                      online={d.online}
                      local={d.local}
                    />
                  ))}
                </div>
              </div>
              <div class="list-header">
                <h2>
                  {repo
                    ? "Tasks"
                    : view === "Inbox"
                    ? "Inbox"
                    : `${view} tasks`}
                </h2>
                <small>{filtered.length} tasks · Alt + ↑ / ↓ to reorder</small>
              </div>
              {!filtered.length && (
                <div class="empty">
                  <span>▱</span>
                  <h2>
                    {c.repositories.length
                      ? "A little space for what’s next"
                      : "Connect your first repository"}
                  </h2>
                  <p>
                    {c.repositories.length
                      ? "Add a task with a clear prompt. Your agents will take it from there."
                      : "Open Settings, connect the Local Agent, and add a local repository and provider profile."}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      c.repositories.length
                        ? (setSelected(""), setEditing(true))
                        : setView("Settings")}
                  >
                    {c.repositories.length
                      ? "＋ Create a task"
                      : "Open Settings →"}
                  </button>
                </div>
              )}
              {statuses.map((status) => {
                const group = filtered.filter((t) => t.status === status);
                return group.length > 0 && (
                  <section key={status} class="task-group">
                    <h3>
                      <StatusBadge status={status} />
                      <small>{group.length}</small>
                    </h3>
                    {group.map((t) => (
                      <div
                        key={t.id}
                        onKeyDown={(e) => {
                          if (
                            e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)
                          ) {
                            e.preventDefault();
                            void execute(() =>
                              c.reorder(t.id, e.key === "ArrowUp" ? -1 : 1)
                            );
                          }
                        }}
                      >
                        <TaskCard
                          title={t.title}
                          status={t.status}
                          selected={selected === t.id}
                          onSelect={() => {
                            setSelected(t.id);
                            setSessionId("");
                            setEditing(false);
                          }}
                        >
                          <span>
                            {c.repositories.find((r) => r.id === t.repositoryId)
                              ?.name}
                          </span>
                          <ProviderBadge
                            provider={c.profile(t)?.provider}
                            name={c.profile(t)?.name ?? "No profile"}
                          />
                          {t.cloud !== "synced" && (
                            <small>On this device</small>
                          )}
                        </TaskCard>
                      </div>
                    ))}
                  </section>
                );
              })}
              <section class="external">
                <h2>
                  External sessions{" "}
                  <small>
                    {c.sessions.filter((s) => s.origin === "external").length}
                  </small>
                </h2>
                <p class="muted">
                  Sessions started outside Prompt Waypoint. They stay separate
                  from your tasks.
                </p>
                {c.sessions.filter((s) => s.origin === "external").map((s) => (
                  <button
                    type="button"
                    class="session-row"
                    onClick={() => {
                      setSessionId(
                        JSON.stringify([s.deviceId, s.providerProfileId, s.id]),
                      );
                      setSelected("");
                      setEditing(false);
                    }}
                  >
                    <ProviderBadge
                      provider={s.provider}
                      name={c.profiles.find((p) =>
                        p.id === s.providerProfileId &&
                        p.deviceId === s.deviceId
                      )?.name}
                    />
                    <span>{s.cwd}</span>
                    <StatusBadge status={s.state} />
                  </button>
                ))}
              </section>
            </div>
          )}
      </main>
      {editing
        ? (
          <Editor
            key={selected || "new"}
            controller={c}
            task={task}
            repositoryId={repo}
            onClose={() => setEditing(false)}
          />
        )
        : task
        ? (
          <aside class="detail">
            <header>
              <span class="eyebrow">TASK DETAILS</span>
              <button
                type="button"
                aria-label="Close detail"
                onClick={() => setSelected("")}
              >
                ×
              </button>
            </header>
            <StatusBadge status={task.status} />
            <h2>{task.title}</h2>
            <ProviderBadge
              provider={c.profile(task)?.provider}
              name={c.profile(task)?.name ?? "No profile selected"}
            />
            <QuotaDisplay
              quota={c.profile(task)?.quota}
              available={c.profile(task)?.available}
            />
            {c.hasPending(task.id) && (
              <button
                type="button"
                disabled={c.busy.has(task.id) ||
                  (c.localRepository(task.repositoryId)
                    ? !c.agentOnline
                    : !c.serverOnline)}
                onClick={() => void execute(() => c.retryPending(task.id))}
              >
                Retry pending delivery
              </button>
            )}
            <h3>Prompt</h3>
            <TaskPrompt prompt={task.prompt} />
            <div class="actions">
              {["inbox", "ready", "completed", "failed"].includes(
                task.status,
              ) && (
                <>
                  <button type="button" onClick={() => setEditing(true)}>
                    Edit task
                  </button>
                  {(["run", "queue"] as const).map((a) => (
                    <button
                      type="button"
                      class={a === "run" ? "primary" : ""}
                      disabled={c.busy.has(task.id) || !!c.reason(task, a)}
                      title={c.reason(task, a)}
                      onClick={() => void execute(() => c.action(task.id, a))}
                    >
                      {a === "run" ? "Run Now ↗" : "Run After Current"}
                    </button>
                  ))}
                  {c.reason(task, "run") && (
                    <small>{c.reason(task, "run")}</small>
                  )}
                </>
              )}
            </div>
            {c.execution(task.id)?.sessionId && (
              <>
                <h3>Execution session</h3>
                <button
                  type="button"
                  onClick={() => {
                    const s = c.sessions.find((s) =>
                      s.id === c.execution(task.id)?.sessionId &&
                      s.providerProfileId ===
                        c.execution(task.id)?.providerProfileId &&
                      s.deviceId === c.execution(task.id)?.deviceId
                    );
                    if (s) {
                      setSessionId(
                        JSON.stringify([s.deviceId, s.providerProfileId, s.id]),
                      );
                      setSelected("");
                    }
                  }}
                >
                  Open session detail →
                </button>
                <textarea
                  aria-label="Follow-up prompt"
                  placeholder="Reply or add an instruction…"
                  value={reply}
                  onInput={(e) => setReply(e.currentTarget.value)}
                />
                <div class="actions">
                  {(["sendPrompt", "resume", "stop"] as const).map((a) => (
                    <button
                      type="button"
                      disabled={c.busy.has(task.id) || !!c.reason(task, a) ||
                        a === "sendPrompt" && !reply.trim()}
                      title={c.reason(task, a)}
                      onClick={() =>
                        void execute(() =>
                          c.action(task.id, a, reply || undefined)
                        )}
                    >
                      {a === "sendPrompt"
                        ? "Send prompt"
                        : a === "resume"
                        ? "Resume"
                        : "Stop"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>
        )
        : session
        ? (
          <aside class="detail">
            <header>
              <span class="eyebrow">SESSION DETAIL</span>
              <button type="button" onClick={() => setSessionId("")}>×</button>
            </header>
            <h2>
              {session.origin === "external"
                ? "External session"
                : "Task execution"}
            </h2>
            <ProviderBadge
              provider={session.provider}
              name={c.profiles.find((p) => p.id === session.providerProfileId)
                ?.name}
            />
            <StatusBadge status={session.state} />
            <dl>
              {Object.entries({
                Repository: c.repositories.find((r) =>
                  r.id === session.repositoryId
                )?.name ?? session.cwd,
                Origin: session.managed ? "Managed" : "External",
                Task: c.tasks.find((t) => t.id === session.taskId)?.title ??
                  "No associated task",
                Started: session.startedAt ?? "Unknown",
                Updated: session.updatedAt,
                Availability: session.stale
                  ? "Stale — refresh first"
                  : session.availability,
              }).map(([k, v]) => (
                <div>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <h3>Last assistant message</h3>
            <TaskPrompt
              prompt={session.lastMessage ?? "No message available"}
            />
            <textarea
              aria-label="Session follow-up"
              value={reply}
              placeholder="Reply to this session…"
              onInput={(e) => setReply(e.currentTarget.value)}
            />
            <div class="actions">
              {(["sendPrompt", "resume", "stop"] as const).map((a) => {
                const p = c.profiles.find((p) =>
                  p.id === session.providerProfileId &&
                  p.deviceId === session.deviceId
                );
                const reason = !p?.capabilities?.[a]
                  ? "Unsupported by provider"
                  : session.stale || session.state === "unknown" ||
                      session.availability !== "available"
                  ? "Refresh session first"
                  : session.deviceId !== c.local?.device.id
                  ? "Use the associated remote task"
                  : session.state === "running" && a !== "stop"
                  ? "Session is already running"
                  : "";
                return (
                  <button
                    type="button"
                    disabled={!!reason || c.busy.has(sessionId) ||
                      a === "sendPrompt" && !reply.trim()}
                    title={reason}
                    onClick={() =>
                      void execute(() =>
                        c.sessionAction(session, a, reply || undefined)
                      )}
                  >
                    {a === "sendPrompt"
                      ? "Send prompt"
                      : a === "resume"
                      ? "Resume"
                      : "Stop"}
                  </button>
                );
              })}
            </div>
          </aside>
        )
        : null}
    </div>
  );
}
