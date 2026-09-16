export type Provider = "codex" | "claude";
export type ExecutionState =
  | "dispatching"
  | "running"
  | "waiting_input"
  | "waiting_quota"
  | "completed"
  | "failed"
  | "unknown";
export interface Device {
  id: string;
  name: string;
  platform: string;
}
export interface Repository {
  id: string;
  deviceId: string;
  name: string;
  localPath: string;
  defaultProviderProfileId?: string;
  available?: boolean;
}
export interface ProviderProfile {
  id: string;
  provider: Provider;
  name: string;
  configDirectory: string;
  autoResume: boolean;
}
export interface Quota {
  state: "available" | "exhausted" | "unknown" | "unsupported";
  observedAt: string;
  usedPercent?: number;
  resetsAt?: string;
}
export interface Session {
  id: string;
  providerProfileId: string;
  provider: Provider;
  cwd: string;
  repositoryId?: string;
  state: Exclude<ExecutionState, "dispatching">;
  observedAt: string;
  updatedAt: string;
  startedAt?: string;
  managed: boolean;
  origin: "companion" | "external";
  taskId?: string;
  lastMessage?: string;
  turnId?: string;
  availability: "available" | "provider_unavailable" | "unknown";
}
export interface Execution {
  id: string;
  taskId: string;
  deviceId: string;
  providerProfileId: string;
  repositoryId: string;
  sessionId?: string;
  turnId?: string;
  state: ExecutionState;
  dispatchedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  autoResume: boolean;
}
export const now = (): string => new Date().toISOString();
export const sessionKey = (profile: string, id: string): string =>
  JSON.stringify([profile, id]);
export type {
  CachedSession,
  Notification,
  ProfileMetadata,
  PushRegistration,
  ServerDevice,
  ServerSnapshot,
  Task,
  TaskDependency,
  TaskStatus,
  User,
} from "./server.ts";

export { DEFAULT_SERVER_URL, PRODUCT_NAME } from "./branding.ts";
