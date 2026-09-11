import { id, parseTaskPatch, strict, text } from "./server.ts";
import type { TaskInput } from "./server.ts";

export interface BatchTaskItem
  extends Omit<TaskInput, "id" | "repositoryId" | "autoResume"> {
  clientId?: string;
  dependsOn?: string[];
  dependsOnClientIds?: string[];
}
export interface TaskBatchInput {
  repositoryId: string;
  tasks: BatchTaskItem[];
  executionMode?: "default" | "manual" | "recommend";
  origin?: { type: "mcp"; client?: string };
}
export function parseTaskBatch(value: unknown): TaskBatchInput {
  const v = strict(value, ["repositoryId", "tasks", "executionMode", "origin"]);
  if (!Array.isArray(v.tasks) || v.tasks.length < 1 || v.tasks.length > 50) {
    throw new Error("Batch requires 1–50 tasks");
  }
  if (
    v.executionMode !== undefined &&
    !["default", "manual", "recommend"].includes(String(v.executionMode))
  ) throw new Error("Invalid executionMode");
  let origin: TaskBatchInput["origin"];
  if (v.origin !== undefined) {
    const o = strict(v.origin, ["type", "client"]);
    if (o.type !== "mcp") throw new Error("Invalid origin");
    origin = {
      type: "mcp",
      ...(o.client === undefined
        ? {}
        : { client: text(o.client, "client", 100) }),
    };
  }
  const list = (value: unknown): string[] | undefined => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > 50) {
      throw new Error("At most 50 dependencies per task");
    }
    return value.map(id);
  };
  const tasks = v.tasks.map((item): BatchTaskItem => {
    const t = strict(item, [
      "clientId",
      "title",
      "prompt",
      "status",
      "priority",
      "providerProfileId",
      "dependsOn",
      "dependsOnClientIds",
    ]);
    const title = text(t.title, "title", 300);
    const prompt = text(t.prompt, "prompt", 100000);
    if (!title.trim() || !prompt.trim()) {
      throw new Error("Title and prompt must not be empty");
    }
    const patch = parseTaskPatch({
      title,
      prompt,
      status: t.status,
      priority: t.priority,
      providerProfileId: t.providerProfileId,
    });
    if (patch.providerProfileId === null) {
      throw new Error("Invalid provider profile");
    }
    return {
      title,
      prompt,
      status: patch.status,
      priority: patch.priority,
      providerProfileId: patch.providerProfileId,
      clientId: t.clientId === undefined ? undefined : id(t.clientId),
      dependsOn: list(t.dependsOn),
      dependsOnClientIds: list(t.dependsOnClientIds),
    };
  });
  const ids = tasks.flatMap((t) => t.clientId ? [t.clientId] : []);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate clientId in batch");
  }
  for (const task of tasks) {
    for (const ref of task.dependsOnClientIds ?? []) {
      if (!ids.includes(ref)) throw new Error("Unknown dependency clientId");
    }
  }
  return {
    repositoryId: id(v.repositoryId),
    tasks,
    executionMode: v.executionMode as TaskBatchInput["executionMode"],
    origin,
  };
}
