import {
  DEFAULT_SERVER_URL,
  type Task,
} from "../../../../packages/core/main.ts";
import type { Command } from "../../../../packages/protocol/main.ts";
export interface DesktopTask extends Task {
  dependencies: string[];
  cloud: "local" | "pending" | "synced";
  revision: number;
  dirty: boolean;
}
export interface Preferences {
  agentUrl: string;
  serverUrl: string;
  notifications: boolean;
  refreshSeconds: number;
  appearance: "system" | "light" | "dark";
}
export const defaults: Preferences = {
  agentUrl: "http://127.0.0.1:7431",
  serverUrl: DEFAULT_SERVER_URL,
  notifications: true,
  refreshSeconds: 60,
  appearance: "system",
};
export interface Persistence {
  all(): DesktopTask[];
  put(task: DesktopTask): void;
  remove(id: string): void;
  pending(id: string): Command | undefined;
  setPending(id: string, command?: Command): void;
  preferences(): Preferences;
  savePreferences(p: Preferences): void;
  cache<T>(name: string, value?: T): T | undefined;
}
export class BrowserPersistence implements Persistence {
  constructor(private storage: Storage) {}
  all(): DesktopTask[] {
    const tasks: DesktopTask[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)!;
      if (key.startsWith("pmai.task.")) {
        tasks.push(JSON.parse(this.storage.getItem(key)!));
      }
    }
    return tasks;
  }
  put(task: DesktopTask) {
    this.storage.setItem(`pmai.task.${task.id}`, JSON.stringify(task));
  }
  remove(id: string) {
    this.storage.removeItem(`pmai.task.${id}`);
  }
  pending(id: string): Command | undefined {
    const value = this.storage.getItem(`pmai.command.${id}`);
    return value ? JSON.parse(value) : undefined;
  }
  setPending(id: string, command?: Command) {
    if (command) {
      this.storage.setItem(`pmai.command.${id}`, JSON.stringify(command));
    } else this.storage.removeItem(`pmai.command.${id}`);
  }
  preferences(): Preferences {
    return {
      ...defaults,
      ...JSON.parse(this.storage.getItem("pmai.preferences") ?? "{}"),
    };
  }
  savePreferences(p: Preferences) {
    this.storage.setItem("pmai.preferences", JSON.stringify(p));
  }
  cache<T>(name: string, value?: T): T | undefined {
    if (value !== undefined) {
      this.storage.setItem(`pmai.cache.${name}`, JSON.stringify(value));
    }
    const stored = this.storage.getItem(`pmai.cache.${name}`);
    return stored ? JSON.parse(stored) : undefined;
  }
}
