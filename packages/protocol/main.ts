import type { Execution } from "../core/main.ts";
export interface Command {
  commandId: string;
  executionId: string;
  action: "run" | "resume" | "sendPrompt" | "stop";
  taskId?: string;
  repositoryId?: string;
  providerProfileId?: string;
  sessionId?: string;
  prompt?: string;
  autoResume?: boolean;
}
export interface CommandResult {
  commandId: string;
  status: "completed" | "failed" | "unknown";
  execution?: Execution;
  error?: string;
  taskState?: "ready";
}
export interface AgentEvent {
  id: string;
  deviceId: string;
  type: string;
  at: string;
  data: unknown;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
}
export function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000_000) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}
export function parseCommand(value: unknown): Command {
  const v = object(value);
  const action = string(v.action, "action");
  if (!["run", "resume", "sendPrompt", "stop"].includes(action)) {
    throw new Error("Invalid action");
  }
  const c: Command = {
    commandId: string(v.commandId, "commandId"),
    executionId: string(v.executionId, "executionId"),
    action: action as Command["action"],
  };
  for (
    const key of [
      "taskId",
      "repositoryId",
      "providerProfileId",
      "sessionId",
      "prompt",
    ] as const
  ) if (v[key] !== undefined) c[key] = string(v[key], key);
  if (v.autoResume !== undefined) {
    if (typeof v.autoResume !== "boolean") {
      throw new Error("Invalid autoResume");
    }
    c.autoResume = v.autoResume;
  }
  if (action === "run" && (!c.taskId || !c.repositoryId || !c.prompt)) {
    throw new Error("Run requires taskId, repositoryId and prompt");
  }
  if (action === "sendPrompt" && !c.prompt) throw new Error("Prompt required");
  return c;
}
export * from "./server.ts";
export * from "./observations.ts";
export * from "./batch.ts";
export * from "./sync.ts";
