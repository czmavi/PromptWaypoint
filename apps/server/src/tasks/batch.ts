import type { Task } from "../../../../packages/core/main.ts";
import { parseTaskBatch } from "../../../../packages/protocol/batch.ts";
import type { ControlPlane } from "../services/control_plane.ts";
import { ApiError } from "../services/errors.ts";
import { save } from "../repositories/store.ts";

/** Atomic domain operation shared by the API and MCP adapters. */
export function createTaskBatch(
  service: ControlPlane,
  userId: string,
  key: string,
  value: unknown,
) {
  let input;
  try {
    input = parseTaskBatch(value);
  } catch (error) {
    throw new ApiError(
      400,
      error instanceof Error ? error.message : "Invalid batch",
    );
  }
  if (input.executionMode === "recommend") {
    throw new ApiError(
      409,
      "AI Task Router is unavailable. Use default or manual executionMode.",
    );
  }
  return service.mutations.run(
    userId,
    key,
    ["createTaskBatch", input],
    async (tx) => {
      const ids = input.tasks.map(() => crypto.randomUUID());
      const clientIds = new Map(
        input.tasks.map((task, i) => [task.clientId, ids[i]]),
      );
      const tasks: Task[] = [];
      const position = Date.now();
      for (const [index, item] of input.tasks.entries()) {
        const {
          clientId: _clientId,
          dependsOn: _dependsOn,
          dependsOnClientIds: _references,
          ...fields
        } = item;
        const created = await service.tasks.create(tx, userId, {
          ...fields,
          id: ids[index],
          repositoryId: input.repositoryId,
        });
        const task: Task = {
          ...created,
          position: position + index,
          ...(input.origin ? { origin: input.origin } : {}),
          executionMode: input.executionMode ?? "default",
        };
        await save(tx, "tasks", userId, task.id, task);
        tasks.push(task);
      }
      for (const [index, item] of input.tasks.entries()) {
        await service.tasks.dependencies(tx, userId, ids[index], [
          ...(item.dependsOn ?? []),
          ...(item.dependsOnClientIds ?? []).map((ref) => clientIds.get(ref)!),
        ]);
      }
      return {
        tasks,
        references: Object.fromEntries(
          input.tasks.flatMap((task, i) =>
            task.clientId ? [[task.clientId, ids[i]]] : []
          ),
        ),
      };
    },
  );
}
