import { addPluginListener, invoke, isTauri } from "@tauri-apps/api/core";
import { ServerClient } from "../../../packages/api-client/main.ts";
import { MobileController } from "./model/controller.ts";
import { MobileStore } from "./model/store.ts";
import {
  deepLink,
  type Destination,
  notificationDestination,
} from "./model/navigation.ts";
export const native = isTauri();
export interface Auth {
  url: string;
  token: string;
}
let previewAuth: Auth | undefined;
export async function readAuth(): Promise<Auth | undefined> {
  if (!native) return previewAuth;
  const { value } = await invoke<{ value: string }>(
    "plugin:companion-native|read_auth",
  );
  return value ? JSON.parse(value) : undefined;
}
export async function clearAuth() {
  if (native) await invoke("plugin:companion-native|clear_auth");
  previewAuth = undefined;
}
export function serverURL(input: string) {
  const url = new URL(input);
  if (
    url.username || url.password || url.search || url.hash ||
    url.pathname !== "/"
  ) throw new Error("Use the server origin, without a path or credentials");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) throw new Error("Use an HTTPS server URL");
  return url.origin;
}
export async function createController(auth: Auth) {
  const url = serverURL(auth.url);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${url}\n${auth.token}`),
  );
  const scope = [...new Uint8Array(bytes)].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  const transport: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15000),
    });
  return new MobileController(
    new MobileStore(localStorage, scope),
    new ServerClient(url, auth.token, transport),
  );
}
export async function connect(auth: Auth) {
  const normalized = { ...auth, url: serverURL(auth.url) };
  if (!auth.token.trim()) throw new Error("Enter your Companion token");
  const controller = await createController(normalized);
  await controller.sync();
  if (!controller.online) throw new Error(controller.error);
  if (native) {
    await invoke("plugin:companion-native|write_auth", {
      value: JSON.stringify(normalized),
    });
  } else previewAuth = normalized;
  return controller;
}
export async function setupNative(
  controller: MobileController,
  navigate: (d: Destination) => void,
) {
  if (!native) return () => {};
  const cleanups: Array<() => void | Promise<void>> = [];
  const route = (input: unknown) => {
    const d = notificationDestination(input);
    if (d) {
      navigate(d);
      void controller.sync();
    }
  };
  const links = await import("@tauri-apps/plugin-deep-link");
  const existing = await links.getCurrent();
  for (const value of existing ?? []) {
    const d = deepLink(value);
    if (d) navigate(d);
  }
  cleanups.push(
    await links.onOpenUrl((urls) => {
      for (const url of urls) {
        const d = deepLink(url);
        if (d) navigate(d);
      }
      void controller.sync();
    }),
  );
  const drain = async () => {
    const { notifications } = await invoke<{ notifications: unknown[] }>(
      "plugin:companion-native|take_notifications",
    );
    for (const item of notifications) route(item);
  };
  const platform = await invoke<string>("platform");
  if (["ios", "android"].includes(platform)) {
    for (
      const [event, handler] of [["notification-tapped", () => {
        void drain();
      }], [
        "notification-received",
        () => {
          void controller.sync();
        },
      ], ["token-received", (value: unknown) => {
        const token = (value as { token?: string }).token;
        if (token && controller.data.push) {
          void controller.registerPush(
            platform === "ios" ? "apns" : "fcm",
            token,
          );
        }
      }]] as const
    ) {
      const listener = await addPluginListener(
        "companion-native",
        event,
        handler,
      );
      cleanups.push(() => listener.unregister());
    }
  }
  await drain();
  if (controller.data.push) {
    void invoke<{ platform: "apns" | "fcm"; token: string }>(
      "plugin:companion-native|request_push",
      { requestPermission: false },
    ).then((r) => controller.registerPush(r.platform, r.token)).catch(() => {});
  }
  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
export async function enablePush(controller: MobileController) {
  if (!native) {
    throw new Error(
      "Push notifications are available in the iOS and Android apps",
    );
  }
  const registration = await invoke<
    { platform: "apns" | "fcm"; token: string }
  >("plugin:companion-native|request_push", { requestPermission: true });
  await controller.registerPush(registration.platform, registration.token);
}

export async function renewAuth(current: MobileController, token: string) {
  const previous = await readAuth();
  if (!previous) throw new Error("Connect to your Companion server again");
  const auth = { url: previous.url, token };
  const next = await createController(auth);
  const snapshot = await next.api.snapshot();
  const owners = new Set(current.snapshot.devices.map((d) => d.userId));
  if (
    owners.size &&
    (!snapshot.devices.length ||
      snapshot.devices.some((d) => !owners.has(d.userId)))
  ) throw new Error("This token belongs to a different workspace");
  current.stop();
  next.data = { ...structuredClone(current.data), snapshot };
  for (const m of next.data.mutations) {
    if (m.error?.includes("Sign in again")) delete m.error;
  }
  next.persist();
  if (native) {
    await invoke("plugin:companion-native|write_auth", {
      value: JSON.stringify(auth),
    });
  } else previewAuth = auth;
  return next;
}
