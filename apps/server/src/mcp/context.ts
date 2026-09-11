import type { ControlPlane } from "../services/control_plane.ts";
import { ApiError } from "../services/errors.ts";
import {
  type PmaiMcpContext,
  PmaiMcpError,
} from "../../../../packages/mcp/context.ts";
export function serverMcpContext(
  service: ControlPlane,
  userId: string,
  beforeCreate: () => void = () => {},
): PmaiMcpContext {
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new PmaiMcpError(
        error instanceof ApiError && error.status < 500
          ? error.message
          : error instanceof PmaiMcpError
          ? error.message
          : "PM.ai service unavailable. Retry with the same mutationId.",
      );
    }
  }
  return {
    snapshot: () => safe(() => service.snapshots.read(userId)),
    createTasks: (input, key) =>
      safe(() => {
        beforeCreate();
        return service.createTasks(userId, key, input);
      }),
    editTask: (taskId, input, key) =>
      safe(() => service.editTask(userId, key, taskId, input)),
    action: (taskId, input, key) =>
      safe(() => service.taskAction(userId, key, taskId, input)),
    dependencies: (taskId, dependsOn, key) =>
      safe(() => service.dependencies(userId, key, taskId, dependsOn)),
  };
}
