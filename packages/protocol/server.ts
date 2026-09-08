import type { Command, CommandResult } from "./main.ts";
import type { Task } from "../core/main.ts";
import { object, string } from "./main.ts";
export interface StoredCommand {
  commandId: string;
  userId: string;
  deviceId: string;
  executionId: string;
  status: "pending" | "delivered" | "acknowledged" | "completed" | "failed";
  payload: Command;
  result?: CommandResult;
  createdAt: string;
}
export interface TaskInput {
  id: string;
  repositoryId: string;
  title: string;
  prompt: string;
  status?: "inbox" | "ready";
  priority?: number;
  providerProfileId?: string;
  autoResume?: boolean;
}
export interface TaskPatch {
  title?: string;
  prompt?: string;
  status?: "inbox" | "ready";
  priority?: number;
  providerProfileId?: string | null;
  autoResume?: boolean;
  position?: number;
}
export interface TaskAction {
  action: "run" | "queue" | "resume" | "stop" | "sendPrompt";
  prompt?: string;
}
export interface ActionResult {
  task: Task;
  command?: StoredCommand;
}
export function strict(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  const v = object(value);
  for (const key of Object.keys(v)) {
    if (!keys.includes(key)) throw new Error(`Unexpected field: ${key}`);
  }
  return v;
}
export function id(value: unknown): string {
  const v = string(value, "id");
  if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(v)) throw new Error("Invalid id");
  return v;
}
export function text(value: unknown, field: string, max = 100000): string {
  const s = string(value, field);
  if (s.length > max) throw new Error(`${field} too long`);
  return s;
}
export function timestamp(value: unknown): string {
  const s = text(value, "timestamp", 50);
  if (!Number.isFinite(Date.parse(s))) throw new Error("Invalid timestamp");
  return new Date(s).toISOString();
}
export function parseTaskPatch(value: unknown): TaskPatch {
  const v = strict(value, [
    "title",
    "prompt",
    "status",
    "priority",
    "providerProfileId",
    "autoResume",
    "position",
  ]);
  const p: TaskPatch = {};
  if (v.title !== undefined) p.title = text(v.title, "title", 300);
  if (v.prompt !== undefined) p.prompt = text(v.prompt, "prompt");
  if (v.status !== undefined) {
    if (v.status !== "inbox" && v.status !== "ready") {
      throw new Error("Only Inbox/Ready are editable states");
    }
    p.status = v.status;
  }
  for (const k of ["position", "priority"] as const) {
    if (v[k] !== undefined) {
      if (
        typeof v[k] !== "number" || !Number.isFinite(v[k]) ||
        Math.abs(v[k]) > 1e9
      ) throw new Error(`Invalid ${k}`);
      p[k] = v[k];
    }
  }
  if (v.providerProfileId !== undefined) {
    p.providerProfileId = v.providerProfileId === null
      ? null
      : id(v.providerProfileId);
  }
  if (v.autoResume !== undefined) {
    if (typeof v.autoResume !== "boolean") {
      throw new Error("Invalid autoResume");
    }
    p.autoResume = v.autoResume;
  }
  return p;
}
export function parseTaskInput(value: unknown): TaskInput {
  const v = strict(value, [
    "id",
    "repositoryId",
    "title",
    "prompt",
    "status",
    "priority",
    "providerProfileId",
    "autoResume",
  ]);
  const { id: taskId, repositoryId, ...rest } = v;
  const patch = parseTaskPatch(rest);
  if (patch.providerProfileId === null) throw new Error("Invalid profile");
  return {
    ...patch,
    id: id(taskId),
    repositoryId: id(repositoryId),
    title: text(v.title, "title", 300),
    prompt: text(v.prompt, "prompt"),
    providerProfileId: patch.providerProfileId,
  };
}
export function parseTaskAction(value: unknown): TaskAction {
  const v = strict(value, ["action", "prompt"]);
  if (
    !["run", "queue", "resume", "stop", "sendPrompt"].includes(String(v.action))
  ) throw new Error("Invalid action");
  const action = v.action as TaskAction["action"];
  const prompt = v.prompt === undefined ? undefined : text(v.prompt, "prompt");
  if (action === "sendPrompt" && !prompt) throw new Error("Prompt required");
  return { action, prompt };
}
