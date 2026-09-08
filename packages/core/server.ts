import type {
  Device,
  Execution,
  ProviderProfile,
  Quota,
  Repository,
  Session,
} from "./main.ts";
import type { ProviderCapabilities } from "../provider-types/main.ts";
export interface User {
  id: string;
  name: string;
}
export interface ServerDevice extends Device {
  userId: string;
  online: boolean;
  lastSeenAt?: string;
}
export type TaskStatus = "inbox" | "ready" | "queued" | Execution["state"];
export interface Task {
  id: string;
  repositoryId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  priority: number;
  position: number;
  providerProfileId?: string;
  autoResume: boolean;
  createdAt: string;
  updatedAt: string;
}
export type ProfileMetadata =
  & Pick<ProviderProfile, "id" | "provider" | "name">
  & {
    deviceId: string;
    capabilities?: ProviderCapabilities;
    quota?: Quota;
    available?: boolean;
  };
export interface CachedSession extends Session {
  deviceId: string;
  stale: boolean;
}
export interface TaskDependency {
  taskId: string;
  dependsOnId: string;
}
export interface PushRegistration {
  id: string;
  platform: "apns" | "fcm";
  token: string;
}
export interface Notification {
  kind: "completed" | "failed" | "waiting_input" | "resumed";
  taskId: string;
  sessionId?: string;
  deviceId: string;
  providerProfileId: string;
  deepLink: string;
}
export interface ServerSnapshot {
  devices: ServerDevice[];
  repositories: Repository[];
  profiles: ProfileMetadata[];
  tasks: Task[];
  dependencies: TaskDependency[];
  executions: Execution[];
  sessions: CachedSession[];
}
