import type { Quota, Session } from "../core/main.ts";
export interface ProviderCapabilities {
  sessionDiscovery: boolean;
  resume: boolean;
  sendPrompt: boolean;
  stop: boolean;
  liveSteering: boolean;
  quotaInspection: boolean;
  quotaResetTime: boolean;
  completionEvents: boolean;
}
export type Observation = Omit<
  Session,
  | "providerProfileId"
  | "provider"
  | "managed"
  | "origin"
  | "taskId"
  | "repositoryId"
>;
export interface CodingAgentProvider {
  capabilities: ProviderCapabilities;
  list(): Promise<Observation[]>;
  inspect(id: string): Promise<Observation>;
  prepare(cwd: string, executionId: string): Promise<Observation>;
  prompt(id: string, prompt: string, commandId: string): Promise<Observation>;
  stop(id: string): Promise<Observation>;
  quota(): Promise<Quota>;
  subscribe(listener: (session?: Observation) => void): () => void;
  close(): Promise<void>;
}
export class ProviderError extends Error {
  constructor(
    public code:
      | "unsupported"
      | "provider_unavailable"
      | "timeout"
      | "conflict",
    message: string = code,
  ) {
    super(message);
  }
}
