/// <reference types="vite/client" />
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  LocalAgentClient,
  ServerClient,
} from "../../../packages/api-client/main.ts";
import { DesktopController, serialized } from "./model/controller.ts";
import { BrowserPersistence } from "./model/storage.ts";
export const native = isTauri();
const memory = new Map<string, string>();
export async function token(name: string, value?: string): Promise<string> {
  if (native) {
    return await invoke(value === undefined ? "read_token" : "write_token", {
      name,
      value,
    });
  }
  if (value !== undefined) memory.set(name, value);
  return memory.get(name) ?? "";
}
export async function capture() {
  if (native) await invoke("show_capture");
  else globalThis.open("/?capture=1", "capture", "width=620,height=760");
}
export async function notify(title: string) {
  if (!native) return;
  const n = await import("@tauri-apps/plugin-notification");
  if (await n.isPermissionGranted()) {
    n.sendNotification({ title: "Companion", body: title });
  }
}
export async function makeController() {
  const storage = new BrowserPersistence(localStorage);
  const prefs = storage.preferences();
  let agentToken = await token("agent").catch(() => "");
  if (!agentToken && native) {
    agentToken = await invoke<string>("agent_token").catch(() => "");
  }
  const serverToken = await token("server").catch(() => "");
  const transport: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15000),
    });
  const devProxy = import.meta.env?.DEV &&
    prefs.agentUrl === "http://127.0.0.1:7431";
  const agentTransport: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return transport(
      devProxy ? new URL(`/__agent${url.pathname}`, location.origin) : input,
      init,
    );
  };
  const local = new LocalAgentClient(
    prefs.agentUrl,
    agentToken,
    agentTransport,
  );
  if (devProxy) {
    local.events = () => {
      const url = new URL("/__agent/events", location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url, ["pmai-events", `pmai-auth.${agentToken}`]);
    };
  }
  return new DesktopController(
    storage,
    local,
    prefs.serverUrl && serverToken
      ? new ServerClient(prefs.serverUrl, serverToken, transport)
      : undefined,
    (key, fn) =>
      navigator.locks ? navigator.locks.request(key, fn) : serialized(key, fn),
    (title) => {
      void notify(title);
    },
  );
}

export async function reconnect(controller: DesktopController) {
  controller.stop();
  const next = await makeController();
  controller.preferences = next.preferences;
  controller.localApi = next.localApi;
  controller.cloudApi = next.cloudApi;
  controller.agentOnline = false;
  controller.serverOnline = false;
  await controller.start();
}

export async function hideCapture() {
  if (native) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }
}
