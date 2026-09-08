import type {
  Execution,
  ProfileMetadata,
  Quota,
  Repository,
  Session,
} from "../core/main.ts";
import type { ProviderCapabilities } from "../provider-types/main.ts";
import { id, strict, text, timestamp } from "./server.ts";
import { object } from "./main.ts";
const states = [
  "dispatching",
  "running",
  "waiting_input",
  "waiting_quota",
  "completed",
  "failed",
  "unknown",
];
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") throw new Error("Boolean required");
  return v;
}
function optional(v: unknown): string | undefined {
  return v === undefined ? undefined : id(v);
}
export function parseCapabilities(value: unknown): ProviderCapabilities {
  const keys = [
    "sessionDiscovery",
    "resume",
    "sendPrompt",
    "stop",
    "liveSteering",
    "quotaInspection",
    "quotaResetTime",
    "completionEvents",
  ] as const;
  const v = strict(value, [...keys]);
  return Object.fromEntries(
    keys.map((k) => [k, bool(v[k])]),
  ) as unknown as ProviderCapabilities;
}
export function parseQuota(value: unknown): Quota {
  const v = strict(value, ["state", "observedAt", "usedPercent", "resetsAt"]);
  if (
    !["available", "exhausted", "unknown", "unsupported"].includes(
      String(v.state),
    )
  ) throw new Error("Invalid quota");
  if (
    v.usedPercent !== undefined &&
    (typeof v.usedPercent !== "number" || v.usedPercent < 0 ||
      v.usedPercent > 100 || !Number.isFinite(v.usedPercent))
  ) throw new Error("Invalid usage");
  return {
    state: v.state as Quota["state"],
    observedAt: timestamp(v.observedAt),
    usedPercent: v.usedPercent as number | undefined,
    resetsAt: v.resetsAt === undefined ? undefined : timestamp(v.resetsAt),
  };
}
export function parseProfile(
  value: unknown,
  deviceId: string,
): ProfileMetadata {
  const v = strict(value, [
    "id",
    "name",
    "provider",
    "capabilities",
    "autoResume",
    "deviceId",
    "quota",
    "available",
  ]);
  if (v.provider !== "codex" && v.provider !== "claude") {
    throw new Error("Invalid provider");
  }
  if (v.deviceId !== undefined && v.deviceId !== deviceId) {
    throw new Error("Device mismatch");
  }
  return {
    id: id(v.id),
    deviceId,
    name: text(v.name, "name", 300),
    provider: v.provider,
    capabilities: v.capabilities === undefined
      ? undefined
      : parseCapabilities(v.capabilities),
    quota: v.quota === undefined ? undefined : parseQuota(v.quota),
    available: v.available === undefined ? undefined : bool(v.available),
  };
}
export function parseRepository(value: unknown, deviceId: string): Repository {
  const v = strict(value, [
    "id",
    "deviceId",
    "name",
    "localPath",
    "defaultProviderProfileId",
    "available",
  ]);
  if (v.deviceId !== deviceId) throw new Error("Device mismatch");
  return {
    id: id(v.id),
    deviceId,
    name: text(v.name, "name", 300),
    localPath: text(v.localPath, "localPath", 4096),
    defaultProviderProfileId: optional(v.defaultProviderProfileId),
    available: v.available === undefined ? undefined : bool(v.available),
  };
}
export function parseExecution(value: unknown): Execution {
  const v = strict(value, [
    "id",
    "taskId",
    "deviceId",
    "providerProfileId",
    "repositoryId",
    "sessionId",
    "turnId",
    "state",
    "dispatchedAt",
    "startedAt",
    "completedAt",
    "error",
    "autoResume",
  ]);
  if (!states.includes(String(v.state))) {
    throw new Error("Invalid execution state");
  }
  return {
    id: id(v.id),
    taskId: id(v.taskId),
    deviceId: id(v.deviceId),
    providerProfileId: id(v.providerProfileId),
    repositoryId: id(v.repositoryId),
    sessionId: optional(v.sessionId),
    turnId: optional(v.turnId),
    state: v.state as Execution["state"],
    dispatchedAt: timestamp(v.dispatchedAt),
    startedAt: v.startedAt === undefined ? undefined : timestamp(v.startedAt),
    completedAt: v.completedAt === undefined
      ? undefined
      : timestamp(v.completedAt),
    error: v.error === undefined ? undefined : text(v.error, "error", 4000),
    autoResume: bool(v.autoResume),
  };
}
export function parseSession(value: unknown): Session {
  const v = strict(value, [
    "id",
    "providerProfileId",
    "provider",
    "cwd",
    "repositoryId",
    "state",
    "observedAt",
    "updatedAt",
    "startedAt",
    "managed",
    "origin",
    "taskId",
    "lastMessage",
    "turnId",
    "availability",
  ]);
  if (
    !states.slice(1).includes(String(v.state)) ||
    !["companion", "external"].includes(String(v.origin)) ||
    !["available", "provider_unavailable", "unknown"].includes(
      String(v.availability),
    ) || !["codex", "claude"].includes(String(v.provider))
  ) throw new Error("Invalid session");
  return {
    id: id(v.id),
    providerProfileId: id(v.providerProfileId),
    provider: v.provider as Session["provider"],
    cwd: text(v.cwd, "cwd", 4096),
    repositoryId: optional(v.repositoryId),
    state: v.state as Session["state"],
    observedAt: timestamp(v.observedAt),
    updatedAt: timestamp(v.updatedAt),
    startedAt: v.startedAt === undefined ? undefined : timestamp(v.startedAt),
    managed: bool(v.managed),
    origin: v.origin as Session["origin"],
    taskId: optional(v.taskId),
    lastMessage: v.lastMessage === undefined
      ? undefined
      : typeof v.lastMessage === "string" && v.lastMessage.length <= 100000
      ? v.lastMessage
      : (() => {
        throw new Error("Invalid message");
      })(),
    turnId: optional(v.turnId),
    availability: v.availability as Session["availability"],
  };
}
export function parseResult(value: unknown): import("./main.ts").CommandResult {
  const v = strict(value, [
    "commandId",
    "status",
    "execution",
    "error",
    "taskState",
  ]);
  if (!["completed", "failed", "unknown"].includes(String(v.status))) {
    throw new Error("Invalid result");
  }
  if (v.taskState !== undefined && v.taskState !== "ready") {
    throw new Error("Invalid task state");
  }
  return {
    commandId: id(v.commandId),
    status: v.status as "completed" | "failed" | "unknown",
    execution: v.execution === undefined
      ? undefined
      : parseExecution(v.execution),
    error: v.error === undefined ? undefined : text(v.error, "error", 4000),
    taskState: v.taskState as "ready" | undefined,
  };
}
export function parseAgentFrame(value: unknown): Record<string, unknown> {
  const v = object(value);
  const allowed: Record<string, string[]> = {
    hello: ["type", "version", "token", "device"],
    registration: ["type", "device", "repositories", "profiles"],
    heartbeat: ["type", "at"],
    heartbeatAck: ["type"],
    ack: ["type", "commandId"],
    commandResult: ["type", "result"],
    event: ["type", "event"],
  };
  if (typeof v.type !== "string" || !allowed[v.type]) {
    throw new Error("Unknown frame");
  }
  return strict(v, allowed[v.type]);
}
