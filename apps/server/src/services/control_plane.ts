import type { PushRegistration, Task } from "../../../../packages/core/main.ts";
import {
  id,
  strict,
  type TaskAction,
  type TaskInput,
  type TaskPatch,
  text,
} from "../../../../packages/protocol/main.ts";
import { type AuthProvider, issue, TokenAuth } from "../auth/auth.ts";
import { Database } from "../db/database.ts";
import { AgentSync } from "../realtime/sync.ts";
import { Catalog } from "./catalog.ts";
import { Mutations } from "./mutations.ts";
import { Observations } from "./observations.ts";
import { Snapshots } from "./snapshot.ts";
import { commandRow, Tasks } from "../tasks/tasks.ts";
import { Scheduler } from "../tasks/scheduler.ts";
import { get } from "../repositories/store.ts";
import { PushQueue } from "../push/queue.ts";
import type { PushProvider } from "../push/providers.ts";
import { createTaskBatch } from "../tasks/batch.ts";
export class ControlPlane {
  auth: AuthProvider;
  private tokenAuth: TokenAuth;
  catalog = new Catalog();
  tasks = new Tasks();
  mutations: Mutations;
  observations: Observations;
  snapshots: Snapshots;
  sync: AgentSync;
  scheduler: Scheduler;
  push: PushQueue;
  private closers = new Set<() => Promise<void>>();
  onClose(close: () => Promise<void>) {
    this.closers.add(close);
  }
  constructor(
    public db: Database,
    options: {
      devSecret?: string;
      auth?: AuthProvider;
      push?: Partial<Record<"apns" | "fcm", PushProvider>>;
      staleMs?: number;
    } = {},
  ) {
    this.tokenAuth = new TokenAuth(db, options.devSecret);
    this.auth = options.auth ?? this.tokenAuth;
    this.mutations = new Mutations(db, (u) => this.changed(u));
    this.observations = new Observations(
      db,
      this.catalog,
      (u) => this.changed(u),
    );
    this.snapshots = new Snapshots(db, options.staleMs);
    this.scheduler = new Scheduler(db, this.tasks);
    this.sync = new AgentSync(db, this.observations, this.scheduler);
    this.push = new PushQueue(db, options.push ?? {});
  }
  login(secret: string) {
    return this.tokenAuth.login(secret);
  }
  async changed(userId: string) {
    // Await request-scoped work. A failed scheduling attempt is retried by the
    // next agent sync; it must not undo or obscure a committed client mutation.
    try {
      await this.scheduler.tick(userId);
    } catch {
      console.error("Scheduling deferred until next agent sync");
    }
  }
  async maintenance() {
    await this.push.flush();
  }
  async registerDevice(userId: string, input: unknown) {
    const result = await this.db.transaction(async (tx) => {
      await tx.lock(userId);
      return this.catalog.registerDevice(tx, userId, input);
    });
    await this.changed(userId);
    return result;
  }
  async deviceToken(userId: string, deviceId: string, revoke = false) {
    const result = await this.db.transaction(async (tx) => {
      await tx.lock(userId);
      await this.catalog.device(tx, userId, deviceId);
      await tx.query(
        "UPDATE auth_tokens SET revoked_at=now() WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL",
        [userId, deviceId],
      );
      await tx.query(
        "UPDATE devices SET last_seen_at=NULL,sync_session_id=NULL,sync_token_hash=NULL,sync_generation=0,sync_ready=false WHERE id=$1 AND user_id=$2",
        [deviceId, userId],
      );
      return revoke
        ? { ok: true }
        : { token: await issue(tx, userId, deviceId) };
    });
    await this.changed(userId);
    return result;
  }
  createTask(userId: string, key: string, input: TaskInput) {
    return this.mutations.run(
      userId,
      key,
      ["createTask", input],
      (tx) => this.tasks.create(tx, userId, input),
    );
  }
  createTasks(userId: string, key: string, input: unknown) {
    return createTaskBatch(this, userId, key, input);
  }
  editTask(userId: string, key: string, taskId: string, input: TaskPatch) {
    return this.mutations.run(
      userId,
      key,
      ["editTask", taskId, input],
      (tx) => this.tasks.edit(tx, userId, taskId, input),
    );
  }
  deleteTask(userId: string, key: string, taskId: string) {
    return this.mutations.run(
      userId,
      key,
      ["deleteTask", taskId],
      (tx) => this.tasks.remove(tx, userId, taskId),
    );
  }
  taskAction(userId: string, key: string, taskId: string, input: TaskAction) {
    return this.mutations.run(
      userId,
      key,
      ["taskAction", taskId, input],
      (tx) => this.tasks.action(tx, userId, taskId, input),
    );
  }
  dependencies(
    userId: string,
    key: string,
    taskId: string,
    dependencies: string[],
  ) {
    return this.mutations.run(userId, key, [
      "dependencies",
      taskId,
      dependencies,
    ], (tx) => this.tasks.dependencies(tx, userId, taskId, dependencies));
  }
  task(userId: string, taskId: string): Promise<Task> {
    return get(this.db, "tasks", userId, taskId);
  }
  async commands(userId: string) {
    return (await this.db.query(
      "SELECT * FROM commands WHERE user_id=$1 ORDER BY created_at",
      [userId],
    )).map(commandRow);
  }
  registerPush(userId: string, key: string, input: unknown) {
    const v = strict(input, ["id", "platform", "token"]);
    if (v.platform !== "apns" && v.platform !== "fcm") {
      throw new Error("Invalid push platform");
    }
    const registration: PushRegistration = {
      id: id(v.id),
      platform: v.platform,
      token: text(v.token, "push token", 4096),
    };
    return this.mutations.run(
      userId,
      key,
      ["push", registration],
      async (tx) => {
        await tx.query(
          "INSERT INTO push_devices(id,user_id,platform,token) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,id) DO UPDATE SET platform=excluded.platform,token=excluded.token",
          [registration.id, userId, registration.platform, registration.token],
        );
        return { id: registration.id, platform: registration.platform };
      },
    );
  }
  removePush(userId: string, key: string, registrationId: string) {
    return this.mutations.run(
      userId,
      key,
      ["removePush", registrationId],
      async (tx) => {
        await tx.query("DELETE FROM push_devices WHERE user_id=$1 AND id=$2", [
          userId,
          registrationId,
        ]);
        return { ok: true };
      },
    );
  }
  async close() {
    await Promise.all([...this.closers].map((close) => close()));
    this.closers.clear();
  }
}
