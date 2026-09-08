import type { ServerSnapshot, Task } from "../../../packages/core/main.ts";
import { type MobileApi, MobileController } from "../src/model/controller.ts";
import { type CaptureInput, MobileStore } from "../src/model/store.ts";
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}
export const capture: CaptureInput = {
  title: "Improve onboarding",
  prompt:
    "Keep this formatting.\n\n  - Explain setup\n  - Ask before removing anything",
  repositoryId: "repo",
};
export function fixture() {
  const caps = {
    sessionDiscovery: true,
    resume: true,
    sendPrompt: true,
    stop: true,
    liveSteering: false,
    quotaInspection: true,
    quotaResetTime: true,
    completionEvents: true,
  };
  const snapshot: ServerSnapshot = {
    devices: [{
      id: "mac",
      userId: "user",
      name: "MacBook Air",
      platform: "darwin",
      online: true,
    }, {
      id: "dgx",
      userId: "user",
      name: "DGX Spark",
      platform: "linux",
      online: false,
      lastSeenAt: "2026-09-01T00:00:00Z",
    }],
    repositories: [{
      id: "repo",
      deviceId: "mac",
      name: "Datovka",
      localPath: "/tmp",
      defaultProviderProfileId: "personal",
    }, {
      id: "remote",
      deviceId: "dgx",
      name: "AI Experiments",
      localPath: "/tmp",
      defaultProviderProfileId: "personal",
    }],
    profiles: [{
      id: "personal",
      deviceId: "mac",
      provider: "codex",
      name: "Codex Personal",
      capabilities: caps,
    }, {
      id: "work",
      deviceId: "mac",
      provider: "claude",
      name: "Claude Work",
      capabilities: { ...caps, stop: false },
    }, {
      id: "personal",
      deviceId: "dgx",
      provider: "claude",
      name: "Claude Personal",
      capabilities: { ...caps, stop: false },
    }],
    tasks: [],
    dependencies: [],
    executions: [],
    sessions: [],
  };
  const calls: { kind: string; key: string; payload: unknown }[] = [];
  const receipts = new Map<string, unknown>();
  let offline = false;
  let loseResponse = false;
  let delay: Promise<void> | undefined;
  let rejectAction = false;
  const network = () => {
    if (offline) throw new Error("Network unavailable");
  };
  const api: MobileApi = {
    snapshot: () => {
      try {
        network();
        return Promise.resolve(structuredClone(snapshot));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    createTask: async (input, key) => {
      network();
      calls.push({ kind: "create", key, payload: structuredClone(input) });
      if (receipts.has(key)) return structuredClone(receipts.get(key)) as Task;
      const at = new Date().toISOString();
      const task: Task = {
        ...input,
        status: input.status ?? "inbox",
        priority: input.priority ?? 0,
        position: snapshot.tasks.length,
        autoResume: false,
        createdAt: at,
        updatedAt: at,
      };
      snapshot.tasks.push(task);
      receipts.set(key, structuredClone(task));
      await delay;
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Response lost");
      }
      return structuredClone(task);
    },
    editTask: (id, patch, key) => {
      network();
      calls.push({ kind: "edit", key, payload: patch });
      const old = snapshot.tasks.find((t) => t.id === id)!;
      const task = {
        ...old,
        ...patch,
        providerProfileId: patch.providerProfileId === null
          ? undefined
          : patch.providerProfileId ?? old.providerProfileId,
      };
      snapshot.tasks = snapshot.tasks.map((t) => t.id === id ? task : t);
      return Promise.resolve(task);
    },
    action: async (id, payload, key) => {
      network();
      calls.push({ kind: "action", key, payload: structuredClone(payload) });
      if (receipts.has(key)) return structuredClone(receipts.get(key)) as never;
      if (rejectAction) throw new Error("Server API 409");
      const task = snapshot.tasks.find((t) => t.id === id)!;
      task.status = payload.action === "queue"
        ? "queued"
        : payload.action === "stop"
        ? "completed"
        : "running";
      const result = { task: structuredClone(task) };
      receipts.set(key, result);
      await delay;
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Response lost");
      }
      return result;
    },
    subscribe: () => Promise.resolve(),
    registerPush: (registration) =>
      Promise.resolve({ id: registration.id, platform: registration.platform }),
    removePush: () => Promise.resolve({ ok: true }),
  };
  const store = new MobileStore(new MemoryStorage(), "test");
  const controller = new MobileController(store, api);
  return {
    controller,
    api,
    store,
    snapshot,
    calls,
    offline: (value: boolean) => offline = value,
    loseResponse: () => loseResponse = true,
    delay: (value: Promise<void>) => delay = value,
    rejectAction: () => rejectAction = true,
  };
}
