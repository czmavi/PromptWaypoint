import { z } from "zod";
export const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/);
export const title = z.string().min(1).max(300).refine(
  (v) => !!v.trim(),
  "Title must not be blank",
);
export const prompt = z.string().min(1).max(100000).refine(
  (v) => !!v.trim(),
  "Prompt must not be blank",
);
export const editableStatus = z.enum(["inbox", "ready"]);
export const status = z.enum([
  "inbox",
  "ready",
  "queued",
  "dispatching",
  "running",
  "waiting_input",
  "waiting_quota",
  "completed",
  "failed",
  "unknown",
]);
export const priority = z.number().min(-1e9).max(1e9);
export const mode = z.enum(["default", "manual", "recommend"]).optional()
  .describe(
    "Defaults to repository profile; recommend requires an installed Task Router (currently unavailable).",
  );
export const mutationId = z.uuid().describe(
  "Generate a UUID once for this logical mutation. Reuse it unchanged on retries, including reconnects. Use a new UUID for a new operation.",
);
export const repository = z.object({
  id,
  name: z.string(),
  deviceId: id,
  device: z.string(),
  localPath: z.string().optional(),
  defaultProviderProfile: id.optional(),
});
export const taskSummary = z.object({
  id,
  title: z.string(),
  status,
  priority: z.number(),
  position: z.number(),
  repositoryId: id,
  repository: z.string(),
  providerProfileId: id.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const execution = z.object({
  id,
  state: z.string(),
  sessionId: z.string().optional(),
  providerProfileId: id,
  dispatchedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export const session = z.object({
  id: z.string(),
  state: z.string(),
  lastAssistantMessage: z.string().optional(),
  observedAt: z.string(),
  stale: z.boolean(),
});
export const taskDetail = taskSummary.extend({
  prompt: z.string(),
  dependsOn: z.array(id),
  deviceId: id,
  provider: z.string().optional(),
  execution: execution.optional(),
  session: session.optional(),
  origin: z.object({ type: z.literal("mcp"), client: z.string().optional() })
    .optional(),
  executionMode: mode,
});
export const item = z.strictObject({
  clientId: id.optional(),
  title,
  prompt,
  status: editableStatus.optional(),
  priority: priority.optional(),
  providerProfileId: id.optional(),
  dependsOn: z.array(id).max(50).optional(),
  dependsOnClientIds: z.array(id).max(50).optional(),
});
export const creation = z.object({
  created: z.number(),
  repository,
  tasks: z.array(taskSummary),
  references: z.record(z.string(), id),
});
export const actionResult = z.object({
  taskId: id,
  status,
  commandId: id.optional(),
  executionId: id.optional(),
  deviceOnline: z.boolean(),
  message: z.string(),
});

export const singleCreation = z.object({
  created: z.literal(true),
  taskId: id,
  title: z.string(),
  status,
  repository,
  task: taskSummary,
});
