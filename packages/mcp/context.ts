import type { ServerSnapshot, Task } from "../core/main.ts";
import type { TaskBatchInput } from "../protocol/batch.ts";
import type { ActionResult, TaskAction, TaskPatch } from "../protocol/main.ts";

/** Auth/transport adapters bind these operations to exactly one authenticated user. */
export interface PmaiMcpContext {
  snapshot(): Promise<ServerSnapshot>;
  createTasks(
    input: TaskBatchInput,
    key: string,
  ): Promise<{ tasks: Task[]; references: Record<string, string> }>;
  editTask(taskId: string, input: TaskPatch, key: string): Promise<Task>;
  dependencies(
    taskId: string,
    dependsOn: string[],
    key: string,
  ): Promise<{ taskId: string; dependsOn: string[] }>;
  action(taskId: string, input: TaskAction, key: string): Promise<ActionResult>;
  currentRepository?: () => Promise<{ repositoryId?: string; message: string }>;
}

export class PmaiMcpError extends Error {}
export function mutationKey(mutationId: string): string {
  return `mcp:${mutationId}`;
}
