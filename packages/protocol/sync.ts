import { id, parseCommand, strict } from "./main.ts";
import type { AgentEvent, Command } from "./main.ts";
import type { Device, ProfileMetadata, Repository } from "../core/main.ts";

export interface AgentConnectRequest {
  generation: number;
  sessionId: string;
  device: Device;
  profiles: Omit<ProfileMetadata, "deviceId">[];
  repositories: Repository[];
}
export interface AgentSyncRequest {
  sessionId: string;
  events: AgentEvent[];
  hasMore: boolean;
  acknowledged: string[];
}
export interface AgentSyncResponse {
  sessionId: string;
  eventIds: string[];
  acknowledged: string[];
  commands: Command[];
  pollAfterMs: number;
}
export function parseAgentSyncResponse(value: unknown): AgentSyncResponse {
  const v = strict(value, [
    "sessionId",
    "eventIds",
    "acknowledged",
    "commands",
    "pollAfterMs",
  ]);
  if (
    !Array.isArray(v.eventIds) || v.eventIds.length > 100 ||
    !Array.isArray(v.acknowledged) || v.acknowledged.length > 100 ||
    !Array.isArray(v.commands) || v.commands.length > 20 ||
    typeof v.pollAfterMs !== "number" || !Number.isFinite(v.pollAfterMs) ||
    v.pollAfterMs < 1000 || v.pollAfterMs > 60000
  ) throw new Error("Invalid sync response");
  return {
    sessionId: id(v.sessionId),
    eventIds: v.eventIds.map(id),
    acknowledged: v.acknowledged.map(id),
    commands: v.commands.map(parseCommand),
    pollAfterMs: v.pollAfterMs,
  };
}
