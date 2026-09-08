import { useRef, useState } from "preact/hooks";
import {
  ProviderBadge,
  QuotaDisplay,
  StatusBadge,
  TaskPrompt,
} from "../../../../packages/ui/main.ts";
import type { MobileController } from "../model/controller.ts";
import type { Task } from "../../../../packages/core/main.ts";
export function TaskDetail(
  { controller: c, task, onBack, onEdit, onSession }: {
    controller: MobileController;
    task: Task;
    onBack: () => void;
    onEdit: () => void;
    onSession: () => void;
  },
) {
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const sending = useRef(false);
  const e = c.execution(task.id);
  const session = c.session(task.id);
  const profile = c.profile(task, !!e);
  const device = c.device(task);
  const pending = c.pending(task.id);
  const editable = ["inbox", "ready", "completed", "failed"].includes(
    task.status,
  );
  const run = async (fn: () => Promise<unknown> | void) => {
    if (sending.current) return;
    sending.current = true;
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      sending.current = false;
    }
  };
  return (
    <article class="task-detail">
      <header class="screen-header">
        <button type="button" class="text-button" onClick={onBack}>
          ← Back
        </button>
        <span>Task</span>
        {editable
          ? (
            <button type="button" class="text-button" onClick={onEdit}>
              Edit
            </button>
          )
          : <span class="header-spacer" />}
      </header>
      <div class="detail-body">
        <StatusBadge status={task.status} />
        <h1>{task.title}</h1>
        <div class="detail-location">
          {c.repository(task)?.name} <span>·</span> {device?.name}
          <span class={`presence ${device?.online ? "online" : ""}`} />
        </div>
        <ProviderBadge
          provider={profile?.provider}
          name={profile?.name ?? "Repository default"}
        />
        {task.status === "waiting_input" && (
          <section class="attention">
            <span class="attention-icon">↳</span>
            <h2>Agent needs input</h2>
            <p>
              {session?.lastMessage ??
                "Your agent is waiting for a reply to continue."}
            </p>
            <label class="sr-only" for="agent-reply">Reply to agent</label>
            <textarea
              id="agent-reply"
              value={reply}
              placeholder="Tell your agent what to do next…"
              onInput={(ev) => setReply(ev.currentTarget.value)}
            />
            <button
              type="button"
              class="primary"
              disabled={!reply.trim() || c.busy.has(task.id) ||
                !!c.reason(task, "sendPrompt")}
              onClick={() =>
                void run(async () => {
                  await c.action(task.id, "sendPrompt", reply);
                  setReply("");
                })}
            >
              Send reply ↑
            </button>
            {c.reason(task, "sendPrompt") && (
              <small>{c.reason(task, "sendPrompt")}</small>
            )}
          </section>
        )}
        {task.status === "waiting_quota" && (
          <section class="attention quota">
            <h2>Waiting for quota</h2>
            <p>
              {profile?.quota?.resetsAt
                ? `Resume expected after ${
                  new Date(profile.quota.resetsAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }`
                : "Waiting for provider capacity"}
            </p>
            {task.autoResume && <strong>Auto-resume enabled</strong>}
          </section>
        )}
        {pending.length > 0 && (
          <section class="pending-panel">
            <h2>Sync pending</h2>
            {pending.map((m) => (
              <div key={m.id}>
                <p>
                  {m.error ??
                    `${
                      m.kind === "action" ? m.payload.action : "Task changes"
                    } waiting for server confirmation`}
                </p>
                <button
                  type="button"
                  onClick={() => void run(() => c.retry(m.id))}
                >
                  Retry same request
                </button>
                {m.error && (
                  <button
                    type="button"
                    onClick={() => void run(() => c.discard(m.id))}
                  >
                    Discard rejected change
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
        <div class="task-actions">
          {editable &&
            (["run", "queue"] as const).map((action) => (
              <button
                key={action}
                type="button"
                class={action === "run" ? "primary" : ""}
                disabled={c.busy.has(task.id) || !!c.reason(task, action)}
                title={c.reason(task, action)}
                onClick={() => void run(() => c.action(task.id, action))}
              >
                {action === "run" ? "Run ↗" : "Queue"}
              </button>
            ))}
          {!editable &&
            (["resume", "stop"] as const).map((action) => (
              <button
                key={action}
                type="button"
                disabled={c.busy.has(task.id) || !!c.reason(task, action)}
                title={c.reason(task, action)}
                onClick={() => void run(() => c.action(task.id, action))}
              >
                {action === "resume" ? "Resume" : "Stop"}
              </button>
            ))}
          {task.status === "inbox" && (
            <button
              type="button"
              onClick={() =>
                void run(() => c.edit(task.id, { status: "ready" }))}
            >
              Move to Ready
            </button>
          )}
        </div>
        {editable && c.reason(task, "run") && (
          <p class="hint">{c.reason(task, "run")}</p>
        )}
        {!editable && c.reason(task, "resume") && (
          <p class="hint">{c.reason(task, "resume")}</p>
        )}
        {error && <p role="alert" class="error">{error}</p>}
        <section class="prompt-section">
          <h2>Prompt</h2>
          <TaskPrompt prompt={task.prompt} />
        </section>
        {session && (
          <section class="session-summary">
            <h2>Execution session</h2>
            <button type="button" class="session-link" onClick={onSession}>
              <span>
                {session.origin === "external" ? "External" : "Managed"} ·{" "}
                {profile?.name}
              </span>
              <span>→</span>
            </button>
            <h3>Last assistant message</h3>
            <TaskPrompt
              prompt={session.lastMessage ?? "No message available yet"}
            />
          </section>
        )}
        <dl class="timestamps">
          {Object.entries({
            Created: task.createdAt,
            Started: e?.startedAt,
            Completed: e?.completedAt,
          }).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value ? new Date(value).toLocaleString() : "—"}</dd>
            </div>
          ))}
        </dl>
        <QuotaDisplay quota={profile?.quota} available={profile?.available} />
      </div>
    </article>
  );
}
