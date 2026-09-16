import type { ServerClient } from "../../../../packages/api-client/main.ts";
import type { PushRegistration, Task } from "../../../../packages/core/main.ts";
import type {
  TaskAction,
  TaskPatch,
} from "../../../../packages/protocol/main.ts";
import {
  type CaptureInput,
  type MobileData,
  MobileStore,
  type Mutation,
} from "./store.ts";
export type MobileApi = Pick<
  ServerClient,
  | "snapshot"
  | "createTask"
  | "editTask"
  | "action"
  | "subscribe"
  | "registerPush"
  | "removePush"
>;
const active = [
  "dispatching",
  "running",
  "waiting_input",
  "waiting_quota",
  "unknown",
];
export class MobileController {
  data: MobileData;
  online = false;
  busy = new Set<string>();
  listeners = new Set<() => void>();
  error = "";
  message = "";
  authExpired = false;
  private syncing?: Promise<void>;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = true;
  constructor(public store: MobileStore, public api: MobileApi) {
    this.data = store.read();
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  persist() {
    this.store.write(this.data);
    this.changed();
  }
  get snapshot() {
    return this.data.snapshot;
  }
  get tasks(): Task[] {
    const tasks = new Map(this.snapshot.tasks.map((t) => [t.id, t]));
    for (const draft of this.data.drafts) tasks.set(draft.id, draft);
    for (const m of this.data.mutations) {
      if (m.error) continue;
      if (m.kind === "edit" && tasks.has(m.taskId)) {
        const old = tasks.get(m.taskId)!;
        tasks.set(m.taskId, {
          ...old,
          ...m.payload,
          providerProfileId: m.payload.providerProfileId === null
            ? undefined
            : m.payload.providerProfileId ?? old.providerProfileId,
        });
      }
    }
    return [...tasks.values()].sort((a, b) =>
      b.priority - a.priority || a.position - b.position
    );
  }
  task(id: string) {
    return this.tasks.find((t) => t.id === id);
  }
  execution(taskId: string) {
    return this.snapshot.executions.filter((e) => e.taskId === taskId).sort((
      a,
      b,
    ) => Date.parse(b.dispatchedAt) - Date.parse(a.dispatchedAt))[0];
  }
  session(taskId: string) {
    const e = this.execution(taskId);
    return this.snapshot.sessions.find((s) =>
      s.id === e?.sessionId && s.deviceId === e?.deviceId &&
      s.providerProfileId === e?.providerProfileId
    );
  }
  repository(task: Task) {
    return this.snapshot.repositories.find((r) => r.id === task.repositoryId);
  }
  device(task: Task) {
    return this.snapshot.devices.find((d) =>
      d.id === this.repository(task)?.deviceId
    );
  }
  profile(task: Task, execution = false) {
    const e = execution ? this.execution(task.id) : undefined;
    const r = this.repository(task);
    return this.snapshot.profiles.find((p) =>
      p.deviceId === (e?.deviceId ?? r?.deviceId) &&
      p.id ===
        (e?.providerProfileId ?? task.providerProfileId ??
          r?.defaultProviderProfileId)
    );
  }
  pending(taskId: string) {
    return this.data.mutations.filter((m) => m.taskId === taskId);
  }
  reason(task: Task, action: TaskAction["action"]): string | undefined {
    if (!this.online) return "You’re offline. Reconnect to control an agent.";
    if (this.pending(task.id).length) {
      return "A change for this task is pending. Sync it first.";
    }
    const d = this.device(task);
    if (!d) return "Device unavailable";
    if (!d.online && action !== "queue") {
      return "Device is offline. Queue the task or try again when it returns.";
    }
    const p = this.profile(task, !["run", "queue"].includes(action));
    if (!p || p.available === false) return "Provider profile unavailable";
    if (this.repository(task)?.available === false) {
      return "Repository unavailable";
    }
    if (action === "run" || action === "queue") {
      if (active.includes(task.status)) {
        return "This task already has an unfinished execution";
      }
      if (
        action === "run" &&
        this.snapshot.dependencies.some((d) =>
          d.taskId === task.id &&
          this.task(d.dependsOnId)?.status !== "completed"
        )
      ) return "Waiting for dependencies";
    } else {
      if (!p.capabilities?.[action]) {
        return "This provider does not support this action";
      }
      const s = this.session(task.id);
      const e = this.execution(task.id);
      if (
        !s || s.stale || s.state === "unknown" || s.availability !== "available"
      ) return "Session state is unavailable. Refresh first.";
      if (e && ["completed", "failed"].includes(e.state)) {
        return "Execution has finished. Start a new Run.";
      }
      if (s.state === "running" && action !== "stop") {
        return "Session is already running";
      }
      if (
        action === "stop" &&
        !["running", "waiting_input", "waiting_quota"].includes(s.state)
      ) return "Session is not active";
    }
    return undefined;
  }
  capture(input: CaptureInput, status: "inbox" | "ready" = "inbox"): Task {
    if (!input.title.trim() || !input.prompt.trim()) {
      throw new Error("Add a title and prompt");
    }
    if (input.title.length > 300 || input.prompt.length > 100000) {
      throw new Error("Title or prompt is too long");
    }
    const r = this.snapshot.repositories.find((r) =>
      r.id === input.repositoryId
    );
    if (!r) {
      throw new Error("Choose a repository from your last synced devices");
    }
    if (
      input.providerProfileId &&
      !this.snapshot.profiles.some((p) =>
        p.id === input.providerProfileId && p.deviceId === r.deviceId
      )
    ) throw new Error("Choose a profile on this device");
    const at = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      title: input.title,
      prompt: input.prompt,
      repositoryId: input.repositoryId,
      providerProfileId: input.providerProfileId,
      status,
      priority: 0,
      position: Date.now() % 1000000000,
      autoResume: input.autoResume ?? false,
      createdAt: at,
      updatedAt: at,
    };
    this.data.drafts.push(task);
    this.data.mutations.push({
      id: crypto.randomUUID(),
      taskId: task.id,
      kind: "create",
      payload: {
        id: task.id,
        repositoryId: task.repositoryId,
        title: task.title,
        prompt: task.prompt,
        status,
        providerProfileId: task.providerProfileId,
        autoResume: task.autoResume,
      },
    });
    this.persist();
    this.message = this.online
      ? "Task saved"
      : "Saved on this phone · sync pending";
    void this.sync();
    return task;
  }
  edit(id: string, patch: TaskPatch) {
    const task = this.task(id);
    if (!task) throw new Error("Task not found");
    if (active.includes(task.status)) {
      throw new Error("Finish the current execution before editing");
    }
    if (
      patch.title !== undefined && !patch.title.trim() ||
      patch.prompt !== undefined && !patch.prompt.trim()
    ) throw new Error("Title and prompt cannot be empty");
    if (this.pending(id).some((m) => m.kind === "action")) {
      throw new Error("Resolve the pending action first");
    }
    this.data.mutations.push({
      id: crypto.randomUUID(),
      taskId: id,
      kind: "edit",
      payload: patch,
    });
    this.persist();
    void this.sync();
  }
  async action(id: string, action: TaskAction["action"], prompt?: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    this.changed();
    try {
      const task = this.task(id);
      if (!task) throw new Error("Task not found");
      const reason = this.reason(task, action);
      if (reason) throw new Error(reason);
      if (action === "sendPrompt" && !prompt?.trim()) {
        throw new Error("Write a reply first");
      }
      const mutation: Mutation = {
        id: crypto.randomUUID(),
        taskId: id,
        kind: "action",
        payload: { action, ...(prompt ? { prompt } : {}) },
      };
      this.data.mutations.push(mutation);
      this.persist();
      await this.sync();
      const pending = this.data.mutations.find((m) => m.id === mutation.id);
      if (pending) {
        throw new Error(
          pending.error ??
            "Delivery pending. Retry will use the same request ID.",
        );
      }
      this.message = action === "queue"
        ? "Queued on the server"
        : "Command sent";
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.busy.delete(id);
      this.changed();
    }
  }
  sync(): Promise<void> {
    if (this.stopped && this.abort?.signal.aborted) return Promise.resolve();
    if (this.syncing) {
      return this.syncing.then(() =>
        this.online &&
          (this.data.mutations.some((m) => !m.attempted && !m.error) ||
            !!this.data.push && this.data.pushSynced !== this.data.push.token)
          ? this.sync()
          : undefined
      );
    }
    this.syncing = this.reconcile().finally(() => this.syncing = undefined);
    return this.syncing;
  }
  private async reconcile() {
    try {
      this.data.snapshot = await this.api.snapshot();
      this.online = true;
      this.authExpired = false;
      this.error = "";
      this.data.lastSync = new Date().toISOString();
      this.persist();
      for (const mutation of [...this.data.mutations]) {
        if (
          mutation.error ||
          this.data.mutations.some((m) =>
            m.taskId === mutation.taskId && m.error &&
            this.data.mutations.indexOf(m) <
              this.data.mutations.indexOf(mutation)
          )
        ) continue;
        mutation.attempted = true;
        this.persist();
        try {
          let task: Task;
          if (mutation.kind === "create") {
            task = await this.api.createTask(mutation.payload, mutation.id);
          } else if (mutation.kind === "edit") {
            task = await this.api.editTask(
              mutation.taskId,
              mutation.payload,
              mutation.id,
            );
          } else {task = (await this.api.action(
              mutation.taskId,
              mutation.payload,
              mutation.id,
            )).task;}
          this.data.snapshot.tasks = [
            ...this.snapshot.tasks.filter((t) => t.id !== task.id),
            task,
          ];
          this.data.drafts = this.data.drafts.filter((t) => t.id !== task.id);
          this.data.mutations = this.data.mutations.filter((m) =>
            m.id !== mutation.id
          );
          this.persist();
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          if (
            /Server API 4\d\d/.test(message) && !message.includes("408") &&
            !message.includes("429")
          ) {
            mutation.error = message.includes("401")
              ? "Sign in again to sync this change"
              : `Server rejected this change (${message}). Review it before retrying.`;
            if (message.includes("401")) this.authExpired = true;
            this.persist();
            continue;
          }
          throw error;
        }
      }
      if (this.data.push && this.data.pushSynced !== this.data.push.token) {
        const registration = structuredClone(this.data.push);
        this.data.pushKey ??= crypto.randomUUID();
        this.persist();
        await this.api.registerPush(registration, this.data.pushKey);
        this.data.pushSynced = registration.token;
        this.persist();
      }
      this.data.snapshot = await this.api.snapshot();
      this.data.lastSync = new Date().toISOString();
      this.persist();
    } catch (e) {
      this.online = false;
      this.authExpired = e instanceof Error && e.message.includes("401");
      this.error = this.authExpired
        ? "Your Prompt Waypoint session expired. Sign in again."
        : "Offline · your saved tasks are available";
      this.changed();
    }
  }
  async retry(id: string) {
    const mutation = this.data.mutations.find((m) => m.id === id);
    if (mutation) delete mutation.error;
    this.persist();
    await this.sync();
  }
  discard(id: string) {
    const mutation = this.data.mutations.find((m) => m.id === id);
    if (!mutation?.error) {
      throw new Error(
        "An uncertain request cannot be discarded; sync its original ID first",
      );
    }
    this.data.mutations = this.data.mutations.filter((m) => m.id !== id);
    if (mutation.kind === "create") {
      this.data.drafts = this.data.drafts.filter((t) =>
        t.id !== mutation.taskId
      );
      this.data.mutations = this.data.mutations.filter((m) =>
        m.taskId !== mutation.taskId
      );
    }
    this.persist();
  }
  async registerPush(platform: PushRegistration["platform"], token: string) {
    if (!token) throw new Error("Push token unavailable");
    if (this.data.push?.token !== token) {
      this.data.pushKey = crypto.randomUUID();
    }
    this.data.push = {
      id: this.data.push?.id ?? crypto.randomUUID(),
      platform,
      token,
    };
    this.persist();
    await this.sync();
  }
  async start() {
    this.stopped = false;
    this.abort = new AbortController();
    void this.api.subscribe(() => {
      void this.sync();
    }, this.abort.signal).catch(() => {});
    this.timer = setInterval(() => void this.sync(), 60000);
    await this.sync();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.abort?.abort();
  }
}
