import { useEffect, useState } from "preact/hooks";
import type { DesktopController } from "../model/controller.ts";
import { ProviderBadge, QuotaDisplay } from "../../../../packages/ui/main.ts";
import { RepositoryForm } from "./RepositoryForm.tsx";
import { ProfileDiscovery } from "./ProfileDiscovery.tsx";
import {
  loginEnabled,
  native,
  pickConfigDirectory,
  reconnect,
  setLoginEnabled,
  startLocalAgent,
  token,
} from "../native.ts";
export function Settings({ controller: c }: { controller: DesktopController }) {
  const [error, setError] = useState("");
  const [prefs, setPrefs] = useState(c.preferences);
  const [auto, setAuto] = useState(false);
  const [configDirectory, setConfigDirectory] = useState("");
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  useEffect(() => {
    if (native) {
      void loginEnabled().then(setAuto).catch(() => {});
    }
  }, []);
  const perform = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await c.refresh();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div class="settings">
      <h1>Settings</h1>
      <p class="muted">A small control room for your agents.</p>
      {error && <p role="alert" class="error">{error}</p>}
      <section>
        <h2>Repositories</h2>
        {c.local?.repositories.map((r) => (
          <div class="setting-row">
            <div>
              <strong>{r.name}</strong>
              <small>{r.localPath}</small>
            </div>
            <select
              aria-label={`Default profile for ${r.name}`}
              value={r.defaultProviderProfileId ?? ""}
              onChange={(ev) =>
                void perform(() =>
                  c.localApi!.updateRepository(r.id, {
                    defaultProviderProfileId: ev.currentTarget.value || null,
                  })
                )}
            >
              <option value="">No default profile</option>
              {c.profiles.filter((p) => p.deviceId === c.local?.device.id).map(
                (p) => <option key={p.id} value={p.id}>{p.name}</option>,
              )}
            </select>
            <button
              type="button"
              onClick={() =>
                void perform(() => c.localApi!.removeRepository(r.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <RepositoryForm
          disabled={!c.agentOnline}
          onAdd={async (repository) => {
            await c.localApi!.addRepository(repository);
            await c.refresh();
          }}
        />
      </section>
      <section>
        <h2>Provider Profiles</h2>
        <p>
          Use local config directories already authenticated with the provider.
          Prompt Waypoint manages metadata only.
        </p>
        <ProfileDiscovery
          api={c.localApi}
          online={c.agentOnline}
          profilesVersion={JSON.stringify(c.local?.profiles.map((p) => p.id))}
          onAdded={() => c.refresh()}
        />
        {c.profiles.map((p) => (
          <div class="profile-row">
            <ProviderBadge provider={p.provider} name={p.name} />
            <small>{p.configDirectory ?? "Configured on remote device"}</small>
            <QuotaDisplay quota={p.quota} available={p.available} />
            <span>
              {p.reconciliation?.availability ??
                (p.available === false
                  ? "Unavailable"
                  : "Availability unknown")}
            </span>
            {p.deviceId === c.local?.device.id && (
              <>
                <label class="check-label">
                  <input
                    type="checkbox"
                    checked={p.autoResume ?? false}
                    onChange={(ev) =>
                      void perform(() =>
                        c.localApi!.updateProfile(p.id, {
                          autoResume: ev.currentTarget.checked,
                        })
                      )}
                  />Auto Resume
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void perform(() => c.localApi!.removeProfile(p.id))}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
        <form
          class="inline-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            const f = ev.currentTarget;
            const d = new FormData(f);
            if (!configDirectory.trim() || choosingDirectory) return;
            void perform(async () => {
              await c.localApi!.addProfile({
                provider: d.get("provider") as "codex" | "claude",
                name: String(d.get("name")),
                configDirectory,
                autoResume: false,
              });
              f.reset();
              setConfigDirectory("");
            });
          }}
        >
          <select name="provider" aria-label="Provider">
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <input
            name="name"
            required
            placeholder="Codex Work"
            aria-label="Profile name"
          />
          <input
            name="directory"
            required
            placeholder="Local config directory"
            aria-label="Config directory"
            value={configDirectory}
            readOnly={native}
            onInput={(ev) => setConfigDirectory(ev.currentTarget.value)}
          />
          {native && (
            <button
              type="button"
              disabled={choosingDirectory}
              onClick={async () => {
                setChoosingDirectory(true);
                try {
                  const directory = await pickConfigDirectory(
                    configDirectory || undefined,
                  );
                  if (directory !== null) setConfigDirectory(directory);
                  setError("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setChoosingDirectory(false);
                }
              }}
            >
              Choose folder…
            </button>
          )}
          <button
            type="submit"
            disabled={!c.agentOnline || choosingDirectory ||
              !configDirectory.trim()}
          >
            Add profile
          </button>
        </form>
      </section>
      <section>
        <h2>Local Agent & Server</h2>
        {native && (
          <div class="setting-row">
            <div>
              <strong>Local Agent</strong>
              <small>
                Run coding tasks on this Mac. Closing the window keeps the agent
                running; quitting the app stops it.
              </small>
            </div>
            <button
              type="button"
              disabled={c.agentOnline}
              onClick={() =>
                void perform(async () => {
                  await startLocalAgent();
                  const next = {
                    ...prefs,
                    agentUrl: "http://127.0.0.1:7431",
                    autoStartLocalAgent: true,
                  };
                  setPrefs(next);
                  c.persistence.savePreferences(next);
                  await reconnect(c);
                })}
            >
              {c.agentOnline ? "Agent connected" : "Start Local Agent"}
            </button>
            <label class="check-label">
              <input
                type="checkbox"
                checked={prefs.autoStartLocalAgent}
                onChange={(ev) => {
                  const next = {
                    ...prefs,
                    autoStartLocalAgent: ev.currentTarget.checked,
                  };
                  setPrefs(next);
                  c.preferences = next;
                  c.persistence.savePreferences(next);
                }}
              />Start agent when Prompt Waypoint opens
            </label>
          </div>
        )}
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const d = new FormData(ev.currentTarget);
            void perform(async () => {
              const agent = new URL(prefs.agentUrl);
              if (
                !["localhost", "127.0.0.1", "[::1]"].includes(agent.hostname)
              ) throw new Error("Local Agent must use localhost");
              if (prefs.serverUrl) {
                const server = new URL(prefs.serverUrl);
                if (
                  server.protocol !== "https:" &&
                  !["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)
                ) throw new Error("Remote server must use HTTPS");
              }
              for (const name of ["agent", "server"]) {
                const value = String(d.get(name) ?? "");
                if (value) await token(name, value);
              }
              c.persistence.savePreferences(prefs);
              await reconnect(c);
            });
          }}
        >
          <label>
            Local Agent URL<input
              value={prefs.agentUrl}
              onInput={(ev) =>
                setPrefs({ ...prefs, agentUrl: ev.currentTarget.value })}
            />
          </label>
          <label>
            Prompt Waypoint Agent token<input
              type="password"
              name="agent"
              autoComplete="off"
              placeholder="Leave blank to keep current token"
            />
          </label>
          <label>
            Server URL (optional)<input
              value={prefs.serverUrl}
              onInput={(ev) =>
                setPrefs({ ...prefs, serverUrl: ev.currentTarget.value })}
            />
          </label>
          <label>
            Prompt Waypoint Server token<input
              type="password"
              name="server"
              autoComplete="off"
              placeholder="Leave blank to keep current token"
            />
          </label>
          <small>
            {native
              ? "Prompt Waypoint tokens are stored in your operating system credential store."
              : "Browser preview keeps tokens in memory only. Use the desktop app for persistent secure authentication."}
          </small>
          <button type="submit" class="primary">Save connections</button>
        </form>
      </section>
      <section>
        <h2>Preferences</h2>
        <label class="check-label">
          <input
            type="checkbox"
            checked={prefs.notifications}
            onChange={(ev) => {
              const next = {
                ...prefs,
                notifications: ev.currentTarget.checked,
              };
              setPrefs(next);
              c.preferences = next;
              c.persistence.savePreferences(next);
              if (next.notifications && native) {
                void perform(async () => {
                  const n = await import("@tauri-apps/plugin-notification");
                  await n.requestPermission();
                });
              }
            }}
          />Notifications
        </label>
        <label class="check-label">
          <input
            type="checkbox"
            disabled={!native}
            checked={auto}
            onChange={(ev) => {
              const enabled = ev.currentTarget.checked;
              void perform(async () => {
                setAuto(await setLoginEnabled(enabled));
              });
            }}
          />Launch Prompt Waypoint at login
        </label>
        <label>
          Reconciliation fallback (seconds)<input
            type="number"
            min="5"
            value={prefs.refreshSeconds}
            onChange={(ev) => {
              const next = {
                ...prefs,
                refreshSeconds: Math.max(5, Number(ev.currentTarget.value)),
              };
              setPrefs(next);
              c.persistence.savePreferences(next);
              c.preferences = next;
              c.stop();
              void c.start();
            }}
          />
        </label>
        <button
          type="button"
          disabled={!c.agentOnline}
          onClick={() => void perform(() => c.localApi!.refresh())}
        >
          Reconcile now
        </button>
        <label>
          Appearance<select
            value={prefs.appearance}
            onChange={(ev) => {
              const next = {
                ...prefs,
                appearance: ev.currentTarget.value as typeof prefs.appearance,
              };
              setPrefs(next);
              c.persistence.savePreferences(next);
              document.documentElement.dataset.appearance = next.appearance;
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <p>
          Quick Capture: ⌘ / Ctrl + Shift + Space. Closing the main window keeps
          Prompt Waypoint in the menu bar.
        </p>
      </section>
    </div>
  );
}
