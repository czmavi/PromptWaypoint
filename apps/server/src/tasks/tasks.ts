import {
  type Execution,
  now,
  type ProfileMetadata,
  type Repository,
  type Task,
} from "../../../../packages/core/main.ts";
import {
  type ActionResult,
  type Command,
  type StoredCommand,
  type TaskAction,
  type TaskInput,
  type TaskPatch,
} from "../../../../packages/protocol/main.ts";
import type { Transaction } from "../db/database.ts";
import { get, save } from "../repositories/store.ts";
import { ApiError } from "../services/errors.ts";
export const activeStates = [
  "dispatching",
  "running",
  "waiting_input",
  "waiting_quota",
  "unknown",
];
export async function profileFor(
  tx: Transaction,
  userId: string,
  repository: Repository,
  override?: string,
): Promise<ProfileMetadata> {
  const id = override ?? repository.defaultProviderProfileId;
  const [row] = await tx.query<{ body: ProfileMetadata }>(
    "SELECT body FROM provider_profiles WHERE user_id=$1 AND device_id=$2 AND id=$3",
    [userId, repository.deviceId, id ?? ""],
  );
  if (!row) {
    throw new ApiError(409, "A provider profile on this device is required");
  }
  return row.body;
}
export class Tasks {
  async create(
    tx: Transaction,
    userId: string,
    input: TaskInput,
  ): Promise<Task> {
    const repository = await get<Repository>(
      tx,
      "repositories",
      userId,
      input.repositoryId,
    );
    if (input.providerProfileId) {
      await profileFor(tx, userId, repository, input.providerProfileId);
    }
    if (
      (await tx.query("SELECT id FROM tasks WHERE id=$1", [input.id])).length
    ) throw new ApiError(409, "Task ID already exists");
    const task: Task = {
      ...input,
      status: input.status ?? "inbox",
      priority: input.priority ?? 0,
      position: Date.now(),
      autoResume: input.autoResume ?? false,
      createdAt: now(),
      updatedAt: now(),
    };
    await tx.query(
      "INSERT INTO tasks(id,user_id,repository_id,body) VALUES($1,$2,$3,$4::jsonb)",
      [task.id, userId, task.repositoryId, task],
    );
    return task;
  }
  async edit(
    tx: Transaction,
    userId: string,
    id: string,
    patch: TaskPatch,
  ): Promise<Task> {
    const old = await get<Task>(tx, "tasks", userId, id);
    if (activeStates.includes(old.status)) {
      throw new ApiError(409, "Task has an unfinished execution");
    }
    if (patch.providerProfileId) {
      await profileFor(
        tx,
        userId,
        await get<Repository>(tx, "repositories", userId, old.repositoryId),
        patch.providerProfileId,
      );
    }
    const task: Task = {
      ...old,
      ...patch,
      providerProfileId: patch.providerProfileId === null
        ? undefined
        : patch.providerProfileId ?? old.providerProfileId,
      updatedAt: now(),
    };
    await save(tx, "tasks", userId, id, task);
    return task;
  }
  async remove(tx: Transaction, userId: string, id: string) {
    await get<Task>(tx, "tasks", userId, id);
    if (
      (await tx.query(
        "SELECT id FROM executions WHERE task_id=$1 AND body->>'state'=ANY($2::text[]) LIMIT 1",
        [id, activeStates],
      )).length
    ) throw new ApiError(409, "Task has an unfinished execution");
    if (
      (await tx.query(
        "SELECT task_id FROM task_dependencies WHERE depends_on_id=$1 LIMIT 1",
        [id],
      )).length
    ) throw new ApiError(409, "Task is a dependency");
    await tx.query(
      "UPDATE tasks SET deleted_at=now() WHERE user_id=$1 AND id=$2",
      [userId, id],
    );
    await tx.query(
      "DELETE FROM task_dependencies WHERE user_id=$1 AND task_id=$2",
      [userId, id],
    );
    return { ok: true };
  }
  async dependencies(
    tx: Transaction,
    userId: string,
    id: string,
    dependencies: string[],
  ) {
    const task = await get<Task>(tx, "tasks", userId, id);
    if (activeStates.includes(task.status)) {
      throw new ApiError(409, "Cannot change dependencies during execution");
    }
    for (const dep of dependencies) {
      const other = await get<Task>(tx, "tasks", userId, dep);
      if (other.repositoryId !== task.repositoryId) {
        throw new ApiError(
          400,
          "Dependencies must belong to the same repository",
        );
      }
    }
    await tx.query(
      "DELETE FROM task_dependencies WHERE task_id=$1 AND user_id=$2",
      [id, userId],
    );
    for (const dep of new Set(dependencies)) {
      const cycle = await tx.query(
        "WITH RECURSIVE ancestors(id) AS (SELECT $1::text UNION SELECT d.depends_on_id FROM task_dependencies d JOIN ancestors a ON d.task_id=a.id WHERE d.user_id=$3) SELECT id FROM ancestors WHERE id=$2",
        [dep, id, userId],
      );
      if (cycle.length) throw new ApiError(409, "Dependency cycle");
      await tx.query(
        "INSERT INTO task_dependencies(user_id,task_id,depends_on_id) VALUES($1,$2,$3)",
        [userId, id, dep],
      );
    }
    return { taskId: id, dependsOn: [...new Set(dependencies)] };
  }
  async blocked(tx: Transaction, taskId: string): Promise<boolean> {
    return (await tx.query(
      "SELECT t.id FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_id WHERE d.task_id=$1 AND t.body->>'status'<>'completed' LIMIT 1",
      [taskId],
    )).length > 0;
  }
  async action(
    tx: Transaction,
    userId: string,
    id: string,
    action: TaskAction,
  ): Promise<ActionResult> {
    let task = await get<Task>(tx, "tasks", userId, id);
    const repository = await get<Repository>(
      tx,
      "repositories",
      userId,
      task.repositoryId,
    );
    const [active] = await tx.query<{ body: Execution }>(
      "SELECT body FROM executions WHERE task_id=$1 AND body->>'state'=ANY($2::text[]) ORDER BY created_at DESC LIMIT 1",
      [id, activeStates],
    );
    if (action.action === "queue") {
      if (active) return { task };
      task = { ...task, status: "queued", updatedAt: now() };
      await save(tx, "tasks", userId, id, task);
      return { task };
    }
    if (action.action === "run" && active) {
      const [row] = await tx.query(
        "SELECT * FROM commands WHERE execution_id=$1 AND payload->>'action'='run' ORDER BY created_at LIMIT 1",
        [active.body.id],
      );
      return { task, command: row ? commandRow(row) : undefined };
    }
    if (action.action === "run" && await this.blocked(tx, id)) {
      throw new ApiError(409, "Task dependencies are incomplete");
    }
    const profile = await profileFor(
      tx,
      userId,
      repository,
      active?.body.providerProfileId ?? task.providerProfileId,
    );
    let execution: Execution;
    if (action.action === "run") {
      execution = {
        id: crypto.randomUUID(),
        taskId: task.id,
        deviceId: repository.deviceId,
        repositoryId: repository.id,
        providerProfileId: profile.id,
        state: "dispatching",
        dispatchedAt: now(),
        autoResume: task.autoResume,
      };
      await tx.query(
        "INSERT INTO executions(id,user_id,task_id,device_id,body) VALUES($1,$2,$3,$4,$5::jsonb)",
        [execution.id, userId, id, repository.deviceId, execution],
      );
      task = { ...task, status: "dispatching", updatedAt: now() };
      await save(tx, "tasks", userId, id, task);
    } else {
      if (!active?.body.sessionId) {
        throw new ApiError(409, "No resumable execution");
      }
      execution = active.body;
      const capability = action.action === "sendPrompt"
        ? "sendPrompt"
        : action.action;
      if (!profile.capabilities?.[capability]) {
        throw new ApiError(409, "Provider capability unavailable");
      }
      const [pending] = await tx.query(
        "SELECT * FROM commands WHERE execution_id=$1 AND status IN ('pending','delivered','acknowledged') AND payload->>'action'=$2 ORDER BY created_at LIMIT 1",
        [execution.id, action.action],
      );
      if (pending) {
        if (
          action.action === "sendPrompt" &&
          (pending.payload as Command).prompt !== action.prompt
        ) throw new ApiError(409, "Another instruction is pending");
        return { task, command: commandRow(pending) };
      }
    }
    const payload: Command = {
      commandId: crypto.randomUUID(),
      executionId: execution.id,
      action: action.action,
      taskId: task.id,
      repositoryId: repository.id,
      providerProfileId: profile.id,
      sessionId: execution.sessionId,
      prompt: action.action === "run" ? task.prompt : action.prompt,
      autoResume: task.autoResume,
    };
    await tx.query(
      "INSERT INTO commands(id,user_id,device_id,execution_id,status,payload) VALUES($1,$2,$3,$4,'pending',$5::jsonb)",
      [payload.commandId, userId, repository.deviceId, execution.id, payload],
    );
    return {
      task,
      command: {
        commandId: payload.commandId,
        userId,
        deviceId: repository.deviceId,
        executionId: execution.id,
        status: "pending",
        payload,
        createdAt: now(),
      },
    };
  }
}
export function commandRow(row: Record<string, unknown>): StoredCommand {
  return {
    commandId: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    executionId: String(row.execution_id),
    status: row.status as StoredCommand["status"],
    payload: row.payload as Command,
    result: row.result as StoredCommand["result"] ?? undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}
