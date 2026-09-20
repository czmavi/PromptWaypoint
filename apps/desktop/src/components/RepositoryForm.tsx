import { useRef, useState } from "preact/hooks";
import { native, pickProjectDirectory } from "../native.ts";

export function RepositoryForm({
  disabled,
  onAdd,
  pickDirectory = native ? pickProjectDirectory : undefined,
}: {
  disabled: boolean;
  onAdd: (repository: { name: string; localPath: string }) => Promise<void>;
  pickDirectory?: (path?: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <form
        class="inline-form"
        aria-label="Add repository"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (disabled || !name.trim() || !path.trim()) return;
          void perform(async () => {
            await onAdd({ name: name.trim(), localPath: path });
            setName("");
            setPath("");
          });
        }}
      >
        <input
          name="name"
          required
          disabled={busy}
          placeholder="Repository name"
          aria-label="Repository name"
          value={name}
          onInput={(ev) => setName(ev.currentTarget.value)}
        />
        <input
          name="path"
          required
          readOnly={!!pickDirectory}
          disabled={busy}
          placeholder={pickDirectory
            ? "No folder selected"
            : "/absolute/repository/path"}
          aria-label="Repository path"
          value={path}
          title={path}
          onInput={(ev) => setPath(ev.currentTarget.value)}
        />
        {pickDirectory && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const selected = await pickDirectory(path || undefined);
                if (selected === null) return;
                setPath(selected);
                setName((current) =>
                  current.trim()
                    ? current
                    : selected.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ||
                      selected
                );
              })}
          >
            {path ? "Change folder…" : "Choose folder…"}
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || busy || !path.trim() || !name.trim()}
        >
          Add repository
        </button>
      </form>
      {error && <p role="alert" class="error">{error}</p>}
    </>
  );
}
