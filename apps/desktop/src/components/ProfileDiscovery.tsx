import { useEffect, useRef, useState } from "preact/hooks";
import type { LocalAgentClient } from "../../../../packages/api-client/main.ts";
import type {
  DiscoveredProviderProfile,
  ProfileDiscoveryResult,
} from "../../../../packages/core/main.ts";

export function ProfileDiscovery({ api, online, profilesVersion, onAdded }: {
  api?: Pick<LocalAgentClient, "discoverProfiles" | "addProfile">;
  online: boolean;
  profilesVersion: string;
  onAdded: () => Promise<void>;
}) {
  const [result, setResult] = useState<ProfileDiscoveryResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setResult(undefined);
    setError("");
    setLoading(!!api && online);
    if (api && online) {
      void api.discoverProfiles().then((found) => {
        if (request === generation.current) setResult(found);
      }).catch(() => {
        if (request === generation.current) {
          setError(
            "Could not discover profiles. Check that the Local Agent is running and up to date, then try again.",
          );
        }
      }).finally(() => {
        if (request === generation.current) setLoading(false);
      });
    }
    return () => {
      generation.current++;
    };
  }, [api, online, profilesVersion, revision]);

  const add = async (profile: DiscoveredProviderProfile) => {
    if (!api || !online || pending.current) return;
    pending.current = true;
    setAdding(true);
    setError("");
    try {
      await api.addProfile({
        provider: profile.provider,
        name: profile.name,
        configDirectory: profile.configDirectory,
        autoResume: false,
      });
      await onAdded();
      setRevision((value) => value + 1);
    } catch {
      setError(
        "Could not add this profile. Check the Local Agent connection and try again.",
      );
    } finally {
      pending.current = false;
      setAdding(false);
    }
  };
  return (
    <div aria-label="Discover provider profiles">
      <div class="setting-row">
        <div>
          <strong>Detected on this computer</strong>
          <small>Find existing Codex and Claude configuration folders.</small>
        </div>
        <button
          type="button"
          disabled={!online || !api || loading || adding}
          onClick={() => setRevision((value) => value + 1)}
        >
          {loading ? "Searching…" : "Scan again"}
        </button>
      </div>
      {!online && (
        <p role="status">Connect the Local Agent to discover profiles.</p>
      )}
      {loading && <p role="status">Searching for profiles…</p>}
      {error && <p role="alert" class="error">{error}</p>}
      {online && result && (
        <>
          {result.warnings.map((warning) => (
            <p key={warning} role="status">{warning}</p>
          ))}
          {result.profiles.length === 0
            ? (
              <p>
                No new profiles found. You can choose a custom configuration
                folder below.
              </p>
            )
            : (
              <p>
                Configuration found; sign-in and provider availability have not
                been checked.
              </p>
            )}
          {result.profiles.map((profile) => (
            <div
              class="setting-row"
              key={`${profile.provider}:${profile.configDirectory}`}
            >
              <div>
                <strong>{profile.name}</strong>
                <small>{profile.configDirectory}</small>
              </div>
              <button
                type="button"
                disabled={adding || loading}
                aria-label={`Add ${profile.name}`}
                onClick={() => void add(profile)}
              >
                Add
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
