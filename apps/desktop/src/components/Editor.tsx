import { useRef, useState } from "preact/hooks";
import type { DesktopController, Draft } from "../model/controller.ts";
import type { DesktopTask } from "../model/storage.ts";
export function Editor(
  { controller: c, task, repositoryId, onClose, quick = false }: {
    controller: DesktopController;
    task?: DesktopTask;
    repositoryId?: string;
    onClose: () => void;
    quick?: boolean;
  },
) {
  const [draft, set] = useState<Draft>({
    id: task?.id,
    title: task?.title ?? "",
    prompt: task?.prompt ?? "",
    repositoryId: task?.repositoryId ?? repositoryId ?? c.repositories[0]?.id ??
      "",
    status: task?.status === "ready" ? "ready" : "inbox",
    providerProfileId: task?.providerProfileId,
    priority: task?.priority ?? 0,
    dependencies: task?.dependencies ?? [],
    autoResume: task?.autoResume ?? false,
  });
  const [busy, b] = useState(false);
  const submitting = useRef(false);
  const [error, e] = useState("");
  const update = (patch: Partial<Draft>) => set({ ...draft, ...patch });
  async function save(status: "inbox" | "ready", run = false) {
    if (submitting.current) return;
    submitting.current = true;
    b(true);
    e("");
    try {
      const saved = await c.save({ ...draft, status });
      set({ ...draft, id: saved.id });
      if (run) await c.action(saved.id, "run");
      onClose();
    } catch (err) {
      e(String(err instanceof Error ? err.message : err));
    } finally {
      submitting.current = false;
      b(false);
    }
  }
  return (
    <section
      class={`editor ${quick ? "quick-editor" : ""}`}
      aria-label="Task editor"
    >
      <header>
        <span class="eyebrow">
          {quick ? "QUICK CAPTURE" : task ? "EDIT TASK" : "NEW TASK"}
        </span>
        <button
          type="button"
          class="icon-button"
          onClick={onClose}
          aria-label="Close editor"
        >
          ×
        </button>
      </header>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void save("inbox");
        }}
        onKeyDown={(ev) => {
          if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
            ev.preventDefault();
            void save("inbox");
          }
        }}
      >
        <label>
          Repository<select
            disabled={!!task}
            value={draft.repositoryId}
            onChange={(ev) =>
              update({
                repositoryId: ev.currentTarget.value,
                dependencies: [],
                providerProfileId: undefined,
              })}
          >
            <option value="" disabled>Choose a repository</option>
            {c.repositories.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <input
          class="title-input"
          aria-label="Title"
          placeholder="What needs to happen?"
          value={draft.title}
          autoFocus
          onInput={(ev) => update({ title: ev.currentTarget.value })}
        />
        <label class="prompt-label">
          Prompt<textarea
            placeholder="Describe the outcome, add context, and let your agent take it from here…"
            value={draft.prompt}
            onInput={(ev) => update({ prompt: ev.currentTarget.value })}
          />
        </label>
        <details>
          <summary>Profile, priority & dependencies</summary>
          <label>
            Provider profile<select
              value={draft.providerProfileId ?? ""}
              onChange={(ev) =>
                update({
                  providerProfileId: ev.currentTarget.value || undefined,
                })}
            >
              <option value="">Repository default</option>
              {c.profiles.filter((p) =>
                p.deviceId ===
                  c.repositories.find((r) => r.id === draft.repositoryId)
                    ?.deviceId
              ).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            Priority<select
              value={draft.priority}
              onChange={(ev) =>
                update({ priority: Number(ev.currentTarget.value) })}
            >
              <option value={0}>Normal</option>
              <option value={1}>High</option>
              <option value={2}>Urgent</option>
            </select>
          </label>
          <fieldset>
            <legend>Wait for tasks</legend>
            {c.tasks.filter((t) =>
              t.repositoryId === draft.repositoryId && t.id !== draft.id
            ).map((t) => (
              <label class="check-label">
                <input
                  type="checkbox"
                  checked={draft.dependencies.includes(t.id)}
                  onChange={(ev) =>
                    update({
                      dependencies: ev.currentTarget.checked
                        ? [...draft.dependencies, t.id]
                        : draft.dependencies.filter((id) => id !== t.id),
                    })}
                />
                {t.title}
              </label>
            ))}
          </fieldset>
          <label class="check-label">
            <input
              type="checkbox"
              checked={draft.autoResume}
              onChange={(ev) =>
                update({ autoResume: ev.currentTarget.checked })}
            />Auto resume when capacity returns
          </label>
        </details>
        {error && <p role="alert" class="error">{error}</p>}
        <footer>
          <button disabled={busy} type="submit">Save to Inbox</button>
          {!quick && (
            <button
              disabled={busy}
              type="button"
              onClick={() => void save("ready")}
            >
              Mark Ready
            </button>
          )}
          <button
            disabled={busy || !c.agentOnline && !c.serverOnline}
            class="primary"
            type="button"
            onClick={() => void save("ready", true)}
          >
            Run Now ↗
          </button>
        </footer>
        <small>⌘ / Ctrl + Enter to save</small>
      </form>
    </section>
  );
}
