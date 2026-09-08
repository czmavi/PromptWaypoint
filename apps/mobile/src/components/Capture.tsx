import { useRef, useState } from "preact/hooks";
import type { MobileController } from "../model/controller.ts";
import type { CaptureInput } from "../model/store.ts";
import type { Task } from "../../../../packages/core/main.ts";
export function Capture(
  { controller: c, onDone, onCancel, initial, task }: {
    controller: MobileController;
    onDone: (id: string) => void;
    onCancel: () => void;
    initial?: Partial<CaptureInput>;
    task?: Task;
  },
) {
  const [value, setValue] = useState<CaptureInput>({
    title: task?.title ?? initial?.title ?? "",
    prompt: task?.prompt ?? initial?.prompt ?? "",
    repositoryId: task?.repositoryId ?? initial?.repositoryId ??
      c.snapshot.repositories[0]?.id ?? "",
    providerProfileId: task?.providerProfileId ?? initial?.providerProfileId,
    autoResume: task?.autoResume ?? false,
  });
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = useRef(task?.id);
  const update = (patch: Partial<CaptureInput>) =>
    setValue({ ...value, ...patch });
  async function submit(run = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let id = saved.current;
      if (id) {
        c.edit(id, {
          title: value.title,
          prompt: value.prompt,
          providerProfileId: value.providerProfileId ?? null,
          status: run ? "ready" : task?.status === "ready" ? "ready" : "inbox",
          autoResume: value.autoResume,
        });
      } else {
        id = c.capture(value, run ? "ready" : "inbox").id;
        saved.current = id;
      }
      if (run) {
        await c.sync();
        await c.action(id, "run");
      }
      onDone(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const repo = c.snapshot.repositories.find((r) => r.id === value.repositoryId);
  const device = c.snapshot.devices.find((d) => d.id === repo?.deviceId);
  return (
    <section class="capture">
      <header class="screen-header">
        <button type="button" class="text-button" onClick={onCancel}>
          Cancel
        </button>
        <strong>{task ? "Edit task" : "New task"}</strong>
        <span class="header-spacer" />
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Repository<select
            disabled={!!saved.current}
            value={value.repositoryId}
            onChange={(e) =>
              update({
                repositoryId: e.currentTarget.value,
                providerProfileId: undefined,
              })}
          >
            <option value="" disabled>Choose a repository</option>
            {c.snapshot.devices.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {c.snapshot.repositories.filter((r) => r.deviceId === d.id).map(
                  (r) => <option key={r.id} value={r.id}>{r.name}</option>,
                )}
              </optgroup>
            ))}
          </select>
        </label>
        <input
          class="capture-title"
          autoFocus
          aria-label="Title"
          placeholder="What’s on your mind?"
          value={value.title}
          onInput={(e) => update({ title: e.currentTarget.value })}
          maxLength={300}
        />
        <label class="prompt-field">
          Prompt<textarea
            placeholder="Describe the outcome. Add context, a few steps, or a thought you don’t want to lose…"
            value={value.prompt}
            onInput={(e) => update({ prompt: e.currentTarget.value })}
            maxLength={100000}
          />
        </label>
        <details>
          <summary>Provider profile & auto-resume</summary>
          <label>
            Provider profile<select
              value={value.providerProfileId ?? ""}
              onChange={(e) =>
                update({
                  providerProfileId: e.currentTarget.value || undefined,
                })}
            >
              <option value="">Auto / Repository default</option>
              {c.snapshot.profiles.filter((p) => p.deviceId === repo?.deviceId)
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.autoResume}
              onChange={(e) => update({ autoResume: e.currentTarget.checked })}
            />Auto-resume when provider capacity returns
          </label>
        </details>
        {!c.snapshot.repositories.length && (
          <p>
            Connect to your server once to choose a repository. You can then
            capture tasks offline.
          </p>
        )}
        {error && <p role="alert" class="error">{error}</p>}
        <footer class="capture-actions">
          <button type="submit" disabled={busy || !repo}>
            {task ? "Save changes" : "Save to Inbox"}
          </button>
          <button
            type="button"
            class="primary"
            disabled={busy || !c.online || !device?.online}
            onClick={() => void submit(true)}
          >
            Run Now ↗
          </button>
        </footer>
        {!c.online
          ? <small>Offline · saving to Inbox is available</small>
          : !device?.online
          ? <small>Device is offline · you can still save this task</small>
          : (
            <small>
              Your repository’s default profile is used automatically.
            </small>
          )}
      </form>
    </section>
  );
}
