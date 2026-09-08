import type {
  Command,
  CommandResult,
} from "../../../packages/protocol/main.ts";
import type { LocalState } from "../../../packages/api-client/main.ts";
import {
  DesktopController,
  type Draft,
  type LocalApi,
} from "../src/model/controller.ts";
import { BrowserPersistence } from "../src/model/storage.ts";
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}
export function fixture() {
  const state: LocalState = {
    device: { id: "local-device", name: "MacBook Air", platform: "darwin" },
    repositories: [{
      id: "repo",
      deviceId: "local-device",
      name: "Datovka",
      localPath: "/tmp/datovka",
      defaultProviderProfileId: "personal",
    }],
    profiles: [{
      id: "personal",
      name: "Codex Personal",
      provider: "codex",
      configDirectory: "/tmp/codex",
      autoResume: false,
      capabilities: {
        sessionDiscovery: true,
        resume: true,
        sendPrompt: true,
        stop: true,
        liveSteering: false,
        quotaInspection: true,
        quotaResetTime: true,
        completionEvents: true,
      },
    }, {
      id: "work",
      name: "Claude Work",
      provider: "claude",
      configDirectory: "/tmp/claude",
      autoResume: false,
      capabilities: {
        sessionDiscovery: true,
        resume: true,
        sendPrompt: true,
        stop: false,
        liveSteering: false,
        quotaInspection: false,
        quotaResetTime: false,
        completionEvents: false,
      },
    }],
    sessions: [],
    executions: [],
  };
  const commands: Command[] = [];
  let offline = false;
  let delay: Promise<void> | undefined;
  const api: LocalApi = {
    state: () =>
      offline
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(structuredClone(state)),
    refresh: () => Promise.resolve({ ok: true }),
    events: () => {
      throw new Error("Test uses manual reconciliation");
    },
    command: async (command) => {
      commands.push(command);
      await delay;
      const e = {
        id: command.executionId,
        taskId: command.taskId!,
        deviceId: state.device.id,
        repositoryId: command.repositoryId ?? "repo",
        providerProfileId: command.providerProfileId!,
        state: "running" as const,
        dispatchedAt: new Date().toISOString(),
        autoResume: false,
        sessionId: command.sessionId ?? "session",
      };
      if (command.taskId) {
        state.executions = [
          ...state.executions.filter((x) => x.id !== e.id),
          e,
        ];
      }
      return {
        commandId: command.commandId,
        status: "completed",
        execution: command.taskId ? e : undefined,
      } satisfies CommandResult;
    },
    addRepository: () => Promise.reject(new Error("unused")),
    removeRepository: () => Promise.resolve({}),
    updateRepository: () => Promise.reject(new Error("unused")),
    addProfile: () => Promise.reject(new Error("unused")),
    updateProfile: () => Promise.reject(new Error("unused")),
    removeProfile: () => Promise.resolve({}),
  };
  const storage = new MemoryStorage();
  const persistence = new BrowserPersistence(storage);
  const controller = new DesktopController(persistence, api);
  return {
    controller,
    state,
    commands,
    api,
    storage,
    persistence,
    offline: (value: boolean) => offline = value,
    delay: (value: Promise<void>) => delay = value,
  };
}
export const draft: Draft = {
  title: "Improve onboarding",
  prompt:
    "Keep the formatting.\n\n  - Explain each step\n  - Keep it accessible",
  repositoryId: "repo",
  status: "inbox",
  priority: 0,
  dependencies: [],
  autoResume: false,
};
