import {
  type Execution,
  now,
  type ProfileMetadata,
  type ProviderProfile,
  type Quota,
  type Repository,
  type ServerSnapshot,
  type Session,
  type Task,
} from "../../../../packages/core/main.ts";
import {
  LocalAgentClient,
  type LocalState,
  ServerClient,
} from "../../../../packages/api-client/main.ts";
import type { TaskAction } from "../../../../packages/protocol/main.ts";
import type { ProviderCapabilities } from "../../../../packages/provider-types/main.ts";
import type { DesktopTask, Persistence, Preferences } from "./storage.ts";
export type Profile = Partial<ProviderProfile & ProfileMetadata> & {
  id: string;
  name: string;
  provider: "codex" | "claude";
  deviceId: string;
  capabilities?: ProviderCapabilities;
  quota?: Quota;
  reconciliation?: { availability?: string };
};
export interface Draft {
  id?: string;
  title: string;
  prompt: string;
  repositoryId: string;
  status: "inbox" | "ready";
  providerProfileId?: string;
  priority: number;
  dependencies: string[];
  autoResume: boolean;
}
export type LocalApi = Pick<
  LocalAgentClient,
  | "state"
  | "command"
  | "refresh"
  | "events"
  | "addRepository"
  | "removeRepository"
  | "updateRepository"
  | "addProfile"
  | "updateProfile"
  | "removeProfile"
>;
export type CloudApi = Pick<
  ServerClient,
  | "snapshot"
  | "createTask"
  | "editTask"
  | "dependencies"
  | "action"
  | "subscribe"
>;
const active = [
  "dispatching",
  "running",
  "waiting_input",
  "waiting_quota",
  "unknown",
];
const locks = new Map<string, Promise<unknown>>();
export async function serialized<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
export class DesktopController {
  local?: LocalState;
  cloud?: ServerSnapshot;
  agentOnline = false;
  serverOnline = false;
  agentError = "Agent not connected";
  serverError = "Server not connected";
  message = "";
  error = "";
  busy = new Set<string>();
  listeners = new Set<() => void>();
  preferences: Preferences;
  private refreshPromise?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private socket?: WebSocket;
  private abort?: AbortController;
  private stopped = false;
  private schedule = true;
  constructor(
    public persistence: Persistence,
    public localApi?: LocalApi,
    public cloudApi?: CloudApi,
    private exclusive: <T>(key: string, fn: () => Promise<T>) => Promise<T> =
      serialized,
    public notify: (title: string) => void = () => {},
  ) {
    this.preferences = persistence.preferences();
    this.local = persistence.cache("agent");
    this.cloud = persistence.cache("server");
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  get repositories(): Repository[] {
    const map = new Map((this.cloud?.repositories ?? []).map((r) => [r.id, r]));
    for (const r of this.local?.repositories ?? []) map.set(r.id, r);
    return [...map.values()];
  }
  get profiles(): Profile[] {
    const map = new Map(
      (this.cloud?.profiles ?? []).map((
        p,
      ) => [`${p.deviceId}:${p.id}`, p as Profile]),
    );
    for (const p of this.local?.profiles ?? []) {
      map.set(`${this.local!.device.id}:${p.id}`, {
        ...p,
        deviceId: this.local!.device.id,
      });
    }
    return [...map.values()];
  }
  get executions(): Execution[] {
    const map = new Map((this.cloud?.executions ?? []).map((e) => [e.id, e]));
    for (const e of this.local?.executions ?? []) map.set(e.id, e);
    return [...map.values()];
  }
  get sessions(): (Session & { deviceId: string; stale?: boolean })[] {
    const map = new Map(
      (this.cloud?.sessions ?? []).map((
        s,
      ) => [JSON.stringify([s.deviceId, s.providerProfileId, s.id]), s]),
    );
    for (const s of this.local?.sessions ?? []) {
      map.set(
        JSON.stringify([this.local!.device.id, s.providerProfileId, s.id]),
        { ...s, deviceId: this.local!.device.id, stale: !this.agentOnline },
      );
    }
    return [...map.values()];
  }
  get tasks(): DesktopTask[] {
    const map = new Map<string, DesktopTask>(
      (this.cloud?.tasks ?? []).map((
        t,
      ) => [t.id, {
        ...t,
        dependencies: (this.cloud?.dependencies ?? []).filter((d) =>
          d.taskId === t.id
        ).map((d) => d.dependsOnId),
        cloud: "synced" as const,
        revision: 0,
        dirty: false,
      }]),
    );
    for (const t of this.persistence.all()) {
      if (
        t.dirty || t.cloud !== "synced" || t.status === "queued" ||
        !map.has(t.id)
      ) map.set(t.id, t);
      else map.set(t.id, { ...map.get(t.id)!, revision: t.revision });
    }
    return [...map.values()].map((t) => {
      const e = this.execution(t.id);
      return e &&
          (active.includes(e.state) ||
            Date.parse(e.dispatchedAt) >= Date.parse(t.updatedAt)) &&
          !(t.status === "queued" && ["completed", "failed"].includes(e.state))
        ? { ...t, status: e.state }
        : t;
    }).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }
  execution(taskId: string): Execution | undefined {
    return this.executions.filter((e) => e.taskId === taskId).sort((a, b) =>
      Date.parse(b.dispatchedAt) - Date.parse(a.dispatchedAt)
    ).at(0);
  }
  profile(
    task: Pick<Task, "repositoryId" | "providerProfileId">,
  ): Profile | undefined {
    const r = this.repositories.find((r) => r.id === task.repositoryId);
    return this.profiles.find((p) =>
      p.deviceId === r?.deviceId &&
      p.id === (task.providerProfileId ?? r?.defaultProviderProfileId)
    );
  }
  localRepository(id: string): boolean {
    return this.repositories.find((r) => r.id === id)?.deviceId ===
      this.local?.device.id;
  }
  reason(task: DesktopTask, action: TaskAction["action"]): string | undefined {
    const local = this.localRepository(task.repositoryId);
    if (local && !this.agentOnline) return "Local Agent is offline";
    if (!local && !this.serverOnline) return "Server is offline";
    if (
      !local && !this.cloud?.devices.find((d) =>
        d.id ===
          this.repositories.find((r) => r.id === task.repositoryId)?.deviceId
      )?.online && action !== "queue"
    ) return "Device is offline — use Run After Current to queue";
    const e = this.execution(task.id);
    const p = action === "run" || action === "queue"
      ? this.profile(task)
      : this.profiles.find((p) =>
        p.id === e?.providerProfileId && p.deviceId === e?.deviceId
      );
    if (!p) return "Choose a provider profile in Settings";
    if (
      p.available === false ||
      p.reconciliation?.availability === "provider_unavailable"
    ) return "Provider is unavailable";
    if (
      this.repositories.find((r) => r.id === task.repositoryId)?.available ===
        false
    ) return "Repository path is unavailable";
    if (action === "run" || action === "queue") {
      if (active.includes(task.status)) {
        return "This task already has an unfinished execution";
      }
      if (
        task.dependencies.some((id) =>
          this.tasks.find((t) => t.id === id)?.status !== "completed"
        )
      ) {
        return action === "run"
          ? "Complete dependencies before running"
          : undefined;
      }
    }
    if (action === "resume" || action === "sendPrompt" || action === "stop") {
      if (!p.capabilities?.[action]) {
        return "This provider does not support this action";
      }
      if (e && ["completed", "failed"].includes(e.state)) {
        return "Open the session detail for a new follow-up";
      }
      if (!e?.sessionId) return "No associated session";
      const s = this.sessions.find((s) =>
        s.id === e.sessionId && s.providerProfileId === e.providerProfileId &&
        s.deviceId === e.deviceId
      );
      if (
        !s || s.stale || s.state === "unknown" || s.availability !== "available"
      ) return "Session state is unknown — refresh first";
      if (s.state === "running" && action !== "stop") {
        return "Session is already running";
      }
    }
    return undefined;
  }
  refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.read().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }
  private async read() {
    const previous = new Map(this.tasks.map((t) => [t.id, t.status]));
    await Promise.allSettled([
      this.localApi
        ? this.localApi.state().then((state) => {
          this.local = state;
          this.agentOnline = true;
          this.agentError = "";
          this.persistence.cache("agent", state);
        }).catch(() => {
          this.agentOnline = false;
          this.agentError = "Local Agent is offline. Your tasks are saved.";
        })
        : Promise.resolve(),
      this.cloudApi
        ? this.cloudApi.snapshot().then((state) => {
          this.cloud = state;
          this.serverOnline = true;
          this.serverError = "";
          this.persistence.cache("server", state);
        }).catch(() => {
          this.serverOnline = false;
          this.serverError = "Server offline · local work is available";
        })
        : Promise.resolve(),
    ]);
    for (const t of this.tasks) {
      if (
        previous.has(t.id) && previous.get(t.id) !== t.status &&
        ["completed", "failed", "waiting_input"].includes(t.status) &&
        this.preferences.notifications
      ) this.notify(`${t.title}: ${t.status.replaceAll("_", " ")}`);
    }
    this.changed();
  }
  async start(schedule = true) {
    this.stopped = false;
    this.schedule = schedule;
    await this.refresh();
    if (this.stopped) return;
    this.connectEvents();
    this.abort = new AbortController();
    if (this.cloudApi) {
      void this.cloudApi.subscribe(() => {
        void this.refresh();
      }, this.abort.signal).catch(() => {});
    }
    this.timer = setInterval(() => {
      void this.refresh().then(async () => {
        await this.syncDrafts();
        if (schedule) await this.dispatchQueued();
        this.connectEvents();
      });
    }, Math.max(5, this.preferences.refreshSeconds) * 1000);
    await this.syncDrafts();
  }
  private connectEvents() {
    if (
      !this.localApi || this.stopped ||
      this.socket &&
        (this.socket.readyState === WebSocket.OPEN ||
          this.socket.readyState === WebSocket.CONNECTING)
    ) return;
    try {
      this.socket = this.localApi.events();
      this.socket.onmessage = () => {
        void this.refresh().then(() =>
          this.schedule ? this.dispatchQueued() : undefined
        ).catch(() => {});
      };
      this.socket.onclose = () => {
        this.socket = undefined;
      };
      this.socket.onerror = () => {
        this.socket?.close();
      };
    } catch { /*Timed fallback retries*/ }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.abort?.abort();
    this.socket?.close();
    this.socket = undefined;
  }
  // Keep validation failures on the asynchronous command boundary.
  // deno-lint-ignore require-await
  async save(draft: Draft): Promise<DesktopTask> {
    if (!draft.title.trim() || !draft.prompt.trim()) {
      throw new Error("Add a title and prompt");
    }
    if (!this.repositories.some((r) => r.id === draft.repositoryId)) {
      throw new Error("Choose a repository");
    }
    const taskId = draft.id ?? crypto.randomUUID();
    const old = this.tasks.find((t) => t.id === taskId);
    if (old && old.repositoryId !== draft.repositoryId) {
      throw new Error("An existing task must remain in its repository");
    }
    if (old && active.includes(old.status)) {
      throw new Error("Stop or finish this execution before editing");
    }
    const dependencies = [...new Set(draft.dependencies)];
    const walk = (id: string, visited = new Set<string>()): boolean =>
      id === taskId ||
      !visited.has(id) &&
        (visited.add(id),
          (this.tasks.find((t) => t.id === id)?.dependencies ?? []).some((d) =>
            walk(d, visited)
          ));
    if (dependencies.some((id) => walk(id))) {
      throw new Error("Dependencies would form a cycle");
    }
    if (
      dependencies.some((id) =>
        this.tasks.find((t) => t.id === id)?.repositoryId !== draft.repositoryId
      )
    ) throw new Error("Dependencies must be in this repository");
    const task: DesktopTask = {
      id: taskId,
      repositoryId: draft.repositoryId,
      title: draft.title,
      prompt: draft.prompt,
      status: draft.status,
      priority: draft.priority,
      position: old?.position ??
        Math.max(0, ...this.tasks.map((t) => t.position)) + 1,
      providerProfileId: draft.providerProfileId,
      autoResume: draft.autoResume,
      createdAt: old?.createdAt ?? now(),
      updatedAt: now(),
      dependencies,
      cloud: old?.cloud ?? (this.cloudApi ? "pending" : "local"),
      revision: (old?.revision ?? 0) + 1,
      dirty: true,
    };
    this.persistence.put(task);
    this.changed();
    void this.syncTask(task);
    this.message = this.serverOnline && this.cloudApi
      ? "Task saved"
      : "Task saved on this device";
    this.changed();
    return task;
  }
  private async syncTask(task: DesktopTask) {
    if (!this.serverOnline || !this.cloudApi || !task.dirty) return;

    await this.exclusive(`pmai-sync-${task.id}`, async () => {
      const journal = this.persistence.cache<
        { task: DesktopTask; done?: boolean }
      >(`sync:${task.id}`);
      task = journal && !journal.done
        ? journal.task
        : this.persistence.all().find((t) => t.id === task.id) ?? task;
      if (!task.dirty) return;
      this.persistence.cache(`sync:${task.id}`, { task });
      try {
        const payload = {
          title: task.title,
          prompt: task.prompt,
          status: ["inbox", "ready"].includes(task.status)
            ? task.status as "inbox" | "ready"
            : "ready" as const,
          priority: task.priority,
          providerProfileId: task.providerProfileId,
          autoResume: task.autoResume,
        };
        const key = `${task.id}:save:${task.revision}`;
        if (task.cloud !== "synced") {
          await this.cloudApi!.createTask({
            id: task.id,
            repositoryId: task.repositoryId,
            ...payload,
          }, key);
        } else {await this.cloudApi!.editTask(task.id, {
            ...payload,
            position: task.position,
          }, key);}
        await this.cloudApi!.dependencies(
          task.id,
          task.dependencies,
          `${key}:dependencies`,
        );
        const stored = this.persistence.all().find((t) => t.id === task.id);
        if (stored?.revision === task.revision) {
          this.persistence.put({ ...stored, cloud: "synced", dirty: false });
        } else if (stored) this.persistence.put({ ...stored, cloud: "synced" });
        this.persistence.cache(`sync:${task.id}`, { task, done: true });
        await this.refresh();
        if (this.localApi && this.localRepository(task.repositoryId)) {
          await this.localApi.refresh();
        }
      } catch {
        this.message = "Saved locally · cloud sync pending";
      }
    });
  }
  async syncDrafts() {
    for (const t of this.persistence.all()) await this.syncTask(t);
  }
  async action(
    taskId: string,
    action: TaskAction["action"],
    prompt?: string,
  ): Promise<void> {
    if (this.busy.has(taskId)) return;
    this.busy.add(taskId);
    this.error = "";
    this.changed();
    try {
      await this.exclusive(`pmai-task-${taskId}`, async () => {
        const before = this.tasks.find((t) => t.id === taskId);
        if (before && this.localRepository(before.repositoryId)) {
          try {
            this.local = await this.localApi!.state();
            this.agentOnline = true;
            this.persistence.cache("agent", this.local);
          } catch {
            this.agentOnline = false;
          }
        } else {
          await this.refresh();
          if (before) await this.syncTask(before);
        }
        const task = this.tasks.find((t) => t.id === taskId);
        if (!task) throw new Error("Task not found");
        if (
          !this.localRepository(task.repositoryId) &&
          (!this.serverOnline || !this.cloudApi || task.cloud !== "synced")
        ) {
          throw new Error(
            "Sync this task to the server before dispatching to a remote device",
          );
        }
        const reason = this.reason(task, action);
        const remotePending = this.persistence.cache<{ done?: boolean }>(
          `remote:${taskId}`,
        );
        if (
          reason && !this.persistence.pending(taskId) &&
          (!remotePending || remotePending.done)
        ) {
          throw new Error(reason);
        }
        const pending = this.persistence.pending(taskId);
        if (pending && pending.action !== action) {
          throw new Error("Resolve the pending command before another action");
        }
        if (action === "queue") {
          this.persistence.put({
            ...task,
            status: "queued",
            dirty: task.dirty,
          });
          if (!this.localRepository(task.repositoryId)) {
            await this.cloudApi!.action(
              taskId,
              { action },
              this.remoteKey(taskId, action, prompt),
            );
          }
          this.persistence.cache(`remote:${taskId}`, { done: true });
          this.message = "Queued after current work";
          this.changed();
          return;
        }
        const existing = this.execution(taskId);
        let command = this.persistence.pending(taskId);
        if (!command) {
          if (
            !this.localRepository(task.repositoryId) && this.serverOnline &&
            this.cloudApi && task.cloud === "synced"
          ) {
            const receipt = await this.cloudApi.action(
              taskId,
              { action, prompt },
              this.remoteKey(taskId, action, prompt),
            );
            command = receipt.command?.payload;
            if (!command) {
              this.persistence.cache(`remote:${taskId}`, { done: true });
              await this.refresh();
              return;
            }
          } else {command = {
              commandId: crypto.randomUUID(),
              executionId: action === "run"
                ? crypto.randomUUID()
                : existing!.id,
              action,
              taskId,
              repositoryId: task.repositoryId,
              providerProfileId: action === "run"
                ? this.profile(task)!.id
                : existing!.providerProfileId,
              sessionId: action === "run" ? undefined : existing?.sessionId,
              prompt: action === "run" ? task.prompt : prompt,
              autoResume: task.autoResume,
            };}
          this.persistence.setPending(taskId, command);
        }
        if (!this.localRepository(task.repositoryId)) {
          if (!this.serverOnline) throw new Error("Server offline");
          this.persistence.setPending(taskId);
          this.persistence.cache(`remote:${taskId}`, { done: true });
          await this.refresh();
          return;
        }
        if (!this.agentOnline) throw new Error("Local Agent is offline");
        const result = await this.localApi!.command(command);
        if (result.status === "failed") {
          this.persistence.setPending(taskId);
          throw new Error(result.error ?? "Agent rejected the command");
        }
        if (result.execution && this.local) {
          this.local = {
            ...this.local,
            executions: [
              ...this.local.executions.filter((e) =>
                e.id !== result.execution!.id
              ),
              result.execution,
            ],
          };
        }
        if (result.status === "unknown") {
          this.persistence.put({ ...task, status: "unknown" });
          throw new Error(
            "Delivery is uncertain. Refresh before retrying; the same command ID is retained.",
          );
        }
        this.persistence.setPending(taskId);
        if (task.status === "queued") {
          this.persistence.put({
            ...task,
            status: result.execution?.state ?? "dispatching",
          });
        }
        this.message = action === "run"
          ? "Task started"
          : action === "stop"
          ? "Stop requested"
          : "Instruction sent";
        await this.refresh();
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Action failed";
      if (this.persistence.pending(taskId)) {
        this.error += ". Delivery pending; retry keeps the same command ID.";
      }
      throw e;
    } finally {
      this.busy.delete(taskId);
      this.changed();
    }
  }
  private remoteKey(taskId: string, action: string, prompt?: string) {
    const previous = this.persistence.cache<
      { id: string; action: string; prompt?: string; done?: boolean }
    >(`remote:${taskId}`);
    if (previous && !previous.done) {
      if (previous.action !== action || previous.prompt !== prompt) {
        throw new Error("Retry the pending server action first");
      }
      return previous.id;
    }
    const next = { id: crypto.randomUUID(), action, prompt };
    this.persistence.cache(`remote:${taskId}`, next);
    return next.id;
  }
  hasPending(taskId: string) {
    const remote = this.persistence.cache<{ done?: boolean }>(
      `remote:${taskId}`,
    );
    return !!this.persistence.pending(taskId) || !!remote && !remote.done;
  }
  async retryPending(taskId: string) {
    const command = this.persistence.pending(taskId);
    if (!command) {
      const remote = this.persistence.cache<
        { action: TaskAction["action"]; prompt?: string; done?: boolean }
      >(`remote:${taskId}`);
      if (remote && !remote.done) {
        await this.action(taskId, remote.action, remote.prompt);
      }
      return;
    }
    if (command) {
      await this.action(
        taskId,
        command.action as TaskAction["action"],
        command.prompt,
      );
    }
  }
  async dispatchQueued() {
    for (
      const task of this.tasks.filter((t) =>
        t.status === "queued" && this.localRepository(t.repositoryId)
      )
    ) {
      if (
        !this.agentOnline ||
        task.dependencies.some((id) =>
          this.tasks.find((t) => t.id === id)?.status !== "completed"
        )
      ) continue;
      if (
        this.executions.some((e) =>
          e.repositoryId === task.repositoryId && active.includes(e.state)
        ) || this.sessions.some((s) =>
          s.repositoryId === task.repositoryId && s.state === "running"
        )
      ) continue;
      try {
        await this.action(task.id, "run");
      } catch { /*Visible error; no blind replay*/ }
    }
  }
  async reorder(taskId: string, direction: -1 | 1) {
    const task = this.tasks.find((t) => t.id === taskId)!;
    const siblings = this.tasks.filter((t) =>
      t.repositoryId === task.repositoryId && t.status === task.status
    );
    const other =
      siblings[siblings.findIndex((t) => t.id === taskId) + direction];
    if (!other) return;
    for (
      const [t, position] of [[task, other.position], [
        other,
        task.position,
      ]] as const
    ) {
      const next = { ...t, position, revision: t.revision + 1, dirty: true };
      this.persistence.put(next);
      await this.syncTask(next);
    }
    this.changed();
  }
  async sessionAction(
    session: Session & { deviceId: string },
    action: "resume" | "sendPrompt" | "stop",
    prompt?: string,
  ) {
    if (session.deviceId !== this.local?.device.id) {
      throw new Error(
        "Open the associated remote Task to control this session",
      );
    }
    if (
      !this.agentOnline || session.state === "unknown" ||
      session.availability !== "available"
    ) throw new Error("Refresh session state first");
    const profile = this.profiles.find((p) =>
      p.id === session.providerProfileId && p.deviceId === session.deviceId
    );
    if (!profile?.capabilities?.[action]) {
      throw new Error("Unsupported capability");
    }
    if (session.state === "running" && action !== "stop") {
      throw new Error("Session is already running");
    }
    const key = JSON.stringify([
      session.deviceId,
      session.providerProfileId,
      session.id,
    ]);
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.changed();
    try {
      const command = this.persistence.pending(key) ??
        {
          commandId: crypto.randomUUID(),
          executionId: crypto.randomUUID(),
          action,
          providerProfileId: session.providerProfileId,
          sessionId: session.id,
          prompt,
        };
      if (command.action !== action || command.prompt !== prompt) {
        throw new Error("Retry the pending session action first");
      }
      this.persistence.setPending(key, command);
      const result = await this.localApi!.command(command);
      if (result.status !== "unknown") this.persistence.setPending(key);
      if (result.status !== "completed") {
        throw new Error(result.error ?? "Session action failed");
      }
      await this.refresh();
    } finally {
      this.busy.delete(key);
      this.changed();
    }
  }
}
