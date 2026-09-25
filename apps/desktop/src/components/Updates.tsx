import { useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../native.ts";
import type { DesktopController } from "../model/controller.ts";
interface Update {
  version: string;
  notes: string;
}
export interface UpdateBridge {
  enabled: boolean;
  check(): Promise<Update | null>;
  install(): Promise<void>;
}
const nativeBridge: UpdateBridge = {
  enabled: native,
  check: () => invoke("check_app_update"),
  install: () => invoke("install_app_update"),
};
export function Updates({ controller, bridge = nativeBridge }: {
  controller: Pick<DesktopController, "start" | "stop">;
  bridge?: UpdateBridge;
}) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function check(manual = false) {
    if (!bridge.enabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const next = await bridge.check();
      setUpdate(next);
      setMessage(manual && !next ? "You’re up to date." : "");
    } catch (e) {
      if (manual) setMessage(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  if (!bridge.enabled) return null;
  return (
    <div class="update-bar">
      <button type="button" disabled={busy} onClick={() => void check(true)}>
        Check for updates
      </button>
      {update && (
        <>
          <span>Version {update.version} is available.</span>
          {update.notes && (
            <details>
              <summary>What’s new</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{update.notes}</p>
            </details>
          )}
          <button
            type="button"
            class="primary"
            disabled={busy}
            onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              setMessage("Downloading and preparing update…");
              controller.stop();
              try {
                await bridge.install();
              } catch (e) {
                setMessage(String(e));
                await controller.start();
              } finally {
                pending.current = false;
                setBusy(false);
              }
            }}
          >
            Update and restart
          </button>
        </>
      )}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
