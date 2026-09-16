import {
  type Execution,
  now,
  type ProfileMetadata,
  type Repository,
  type Task,
} from "../../../../packages/core/main.ts";
import {
  id,
  object,
  parseExecution,
  parseProfile,
  parseQuota,
  parseResult,
  parseSession,
  strict,
  timestamp,
} from "../../../../packages/protocol/main.ts";
import type { Database, Transaction } from "../db/database.ts";
import { get, save } from "../repositories/store.ts";
import { Catalog } from "./catalog.ts";
import { ApiError } from "./errors.ts";
import { enqueue } from "../push/queue.ts";
export class Observations {
  constructor(
    private db: Database,
    private catalog: Catalog,
    private changed: (userId: string) => Promise<void>,
  ) {}
  async registration(
    userId: string,
    deviceId: string,
    value: Record<string, unknown>,
    transaction?: Transaction,
  ) {
    const apply = async (tx: Transaction) => {
      await tx.lock(userId);
      const device = strict(value.device, ["id", "name", "platform"]);
      if (device.id !== deviceId) throw new ApiError(403, "Device mismatch");
      if (
        !Array.isArray(value.profiles) || !Array.isArray(value.repositories) ||
        value.profiles.length > 1000 || value.repositories.length > 10000
      ) throw new Error("Invalid registration");
      for (const p of value.profiles) {
        await this.catalog.profile(tx, userId, deviceId, p);
      }
      for (const r of value.repositories) {
        await this.catalog.repository(tx, userId, deviceId, r);
      }
    };
    if (transaction) await apply(transaction);
    else {
      await this.db.transaction(apply);
      await this.changed(userId);
    }
  }
  async execution(
    tx: Transaction,
    userId: string,
    deviceId: string,
    value: unknown,
    at: string,
    key: string,
    fallback = false,
  ) {
    const e = parseExecution(value);
    if (e.deviceId !== deviceId) throw new ApiError(403, "Device mismatch");
    let [row] = await tx.query<{ body: Execution; observed_at: Date | null }>(
      "SELECT body,observed_at FROM executions WHERE user_id=$1 AND device_id=$2 AND id=$3",
      [userId, deviceId, e.id],
    );
    // Adopt local executions only after their task is explicitly synced by Desktop.
    // Observing external sessions must never create cloud backlog entries.
    if (!row) {
      if (fallback) return;
      const [taskRow] = await tx.query<{ body: Task }>(
        "SELECT body FROM tasks WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL",
        [userId, e.taskId],
      );
      if (!taskRow) return;
      const repository = await get<Repository>(
        tx,
        "repositories",
        userId,
        taskRow.body.repositoryId,
      );
      const [profile] = await tx.query(
        "SELECT id FROM provider_profiles WHERE user_id=$1 AND device_id=$2 AND id=$3",
        [userId, deviceId, e.providerProfileId],
      );
      if (
        repository.deviceId !== deviceId || repository.id !== e.repositoryId ||
        !profile
      ) throw new ApiError(403, "Local execution identity mismatch");
      const [active] = await tx.query(
        "SELECT id FROM executions WHERE user_id=$1 AND task_id=$2 AND body->>'state' IN ('dispatching','running','waiting_input','waiting_quota','unknown')",
        [userId, e.taskId],
      );
      // A competing server dispatch is resolved by its command result before adoption.
      if (active) return;
      await tx.query(
        "INSERT INTO executions(id,user_id,task_id,device_id,body) VALUES($1,$2,$3,$4,$5::jsonb)",
        [e.id, userId, e.taskId, deviceId, { ...e, state: "dispatching" }],
      );
      row = { body: { ...e, state: "dispatching" }, observed_at: null };
    }
    const old = row.body;
    if (fallback && row.observed_at) return;
    if (e.state === "dispatching" && old.state !== "dispatching") return;
    if (
      old.taskId !== e.taskId || old.repositoryId !== e.repositoryId ||
      old.providerProfileId !== e.providerProfileId ||
      (old.sessionId && old.sessionId !== e.sessionId)
    ) throw new ApiError(403, "Execution identity mismatch");
    if (row.observed_at && row.observed_at.getTime() > Date.parse(at)) return;
    if (["completed", "failed"].includes(old.state)) return;
    const observed: Execution = {
      ...e,
      dispatchedAt: old.dispatchedAt,
      autoResume: old.autoResume,
    };
    await tx.query(
      "UPDATE executions SET body=$3::jsonb,observed_at=$4 WHERE user_id=$1 AND id=$2",
      [userId, e.id, observed, fallback ? null : at],
    );
    const task = await get<Task>(tx, "tasks", userId, e.taskId);
    await save(tx, "tasks", userId, task.id, {
      ...task,
      status: e.state,
      updatedAt: now(),
    });
    const kind = old.state === e.state
      ? undefined
      : e.state === "completed" || e.state === "failed" ||
          e.state === "waiting_input"
      ? e.state
      : old.state === "waiting_quota" && e.state === "running"
      ? "resumed"
      : undefined;
    if (kind) {
      await enqueue(tx, userId, key, {
        kind,
        taskId: e.taskId,
        sessionId: e.sessionId,
        deviceId,
        providerProfileId: e.providerProfileId,
        deepLink: `pmai://tasks/${encodeURIComponent(e.taskId)}`,
      });
    }
  }
  async result(
    tx: Transaction,
    userId: string,
    deviceId: string,
    value: unknown,
    at: string,
    key: string,
  ) {
    const result = parseResult(value);
    const [row] = await tx.query<{ execution_id: string; status: string }>(
      "SELECT execution_id,status FROM commands WHERE user_id=$1 AND device_id=$2 AND id=$3",
      [userId, deviceId, result.commandId],
    );
    if (!row) return; // Includes the agent's independently journaled quota commands.
    if (result.execution && result.execution.id !== row.execution_id) {
      throw new ApiError(403, "Command execution mismatch");
    }
    if (row.status === "completed" || row.status === "failed") return;
    if (result.execution) {
      await this.execution(
        tx,
        userId,
        deviceId,
        result.execution,
        at,
        key,
        true,
      );
    }
    // The command can complete while its actual execution remains running.
    await tx.query(
      "UPDATE commands SET status=$4,result=$5::jsonb WHERE user_id=$1 AND device_id=$2 AND id=$3",
      [
        userId,
        deviceId,
        result.commandId,
        result.status === "completed" ? "completed" : "failed",
        result,
      ],
    );
    if (result.taskState === "ready") {
      const e = await get<Execution>(
        tx,
        "executions",
        userId,
        row.execution_id,
      );
      if (["dispatching", "failed"].includes(e.state)) {
        await save(tx, "executions", userId, e.id, {
          ...e,
          state: "failed",
          error: result.error ?? "Not submitted",
        });
        const task = await get<Task>(tx, "tasks", userId, e.taskId);
        await save(tx, "tasks", userId, task.id, {
          ...task,
          status: "ready",
          updatedAt: now(),
        });
      }
    } else if (result.status !== "completed") {
      const e = await get<Execution>(
        tx,
        "executions",
        userId,
        row.execution_id,
      );
      if (e.state === "dispatching") {
        await save(tx, "executions", userId, e.id, { ...e, state: "unknown" });
        const task = await get<Task>(tx, "tasks", userId, e.taskId);
        await save(tx, "tasks", userId, task.id, {
          ...task,
          status: "unknown",
          updatedAt: now(),
        });
      }
    }
  }
  async event(
    userId: string,
    deviceId: string,
    input: unknown,
    transaction?: Transaction,
  ): Promise<string> {
    const v = strict(input, ["id", "deviceId", "type", "at", "data"]);
    const eventId = id(v.id);
    const at = timestamp(v.at);
    if (v.deviceId !== deviceId || Date.parse(at) > Date.now() + 300000) {
      throw new ApiError(400, "Invalid event identity/time");
    }
    const apply = async (tx: Transaction) => {
      await tx.lock(userId);
      const inserted = await tx.query(
        "INSERT INTO agent_events(device_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [deviceId, eventId],
      );
      if (!inserted.length) return;
      switch (v.type) {
        case "execution":
          await this.execution(tx, userId, deviceId, v.data, at, eventId);
          break;
        case "commandResult":
          await this.result(tx, userId, deviceId, v.data, at, eventId);
          break;
        case "session": {
          const s = parseSession(v.data);
          const [profile] = await tx.query<{ body: ProfileMetadata }>(
            "SELECT body FROM provider_profiles WHERE user_id=$1 AND device_id=$2 AND id=$3",
            [userId, deviceId, s.providerProfileId],
          );
          if (!profile || profile.body.provider !== s.provider) {
            throw new ApiError(400, "Unknown session profile");
          }
          if (
            s.repositoryId &&
            (await get<Repository>(tx, "repositories", userId, s.repositoryId))
                .deviceId !== deviceId
          ) throw new ApiError(403, "Repository mismatch");
          if (Date.parse(s.observedAt) > Date.now() + 300000) {
            throw new Error("Future observation");
          }
          await tx.query(
            "INSERT INTO sessions(device_id,profile_id,id,user_id,body,observed_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(device_id,profile_id,id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at WHERE sessions.observed_at<excluded.observed_at",
            [deviceId, s.providerProfileId, s.id, userId, s, s.observedAt],
          );
          break;
        }
        case "repository":
          await this.catalog.repository(tx, userId, deviceId, v.data);
          break;
        case "profile":
          await this.catalog.profile(
            tx,
            userId,
            deviceId,
            parseProfile(v.data, deviceId),
          );
          break;
        case "quota": {
          const data = strict(v.data, ["providerProfileId", "quota"]);
          const quota = parseQuota(data.quota);
          const profileId = id(data.providerProfileId);
          const [p] = await tx.query<{ body: ProfileMetadata }>(
            "SELECT body FROM provider_profiles WHERE device_id=$1 AND id=$2",
            [deviceId, profileId],
          );
          if (!p) throw new Error("Unknown quota profile");
          if (
            !p.body.quota ||
            Date.parse(p.body.quota.observedAt) < Date.parse(quota.observedAt)
          ) {
            await tx.query(
              "UPDATE provider_profiles SET body=$3::jsonb WHERE device_id=$1 AND id=$2",
              [deviceId, profileId, { ...p.body, quota }],
            );
          }
          break;
        }
        case "removed": {
          const data = strict(v.data, ["collection", "id"]);
          const resourceId = id(data.id);
          if (data.collection === "repositories") {
            await tx.query(
              "UPDATE repositories SET body=jsonb_set(body,'{available}','false') WHERE device_id=$1 AND id=$2",
              [deviceId, resourceId],
            );
          } else if (data.collection === "profiles") {
            await tx.query(
              "UPDATE provider_profiles SET body=jsonb_set(body,'{available}','false') WHERE device_id=$1 AND id=$2",
              [deviceId, resourceId],
            );
          } else throw new Error("Invalid collection");
          break;
        }
        default:
          throw new Error("Unsupported event");
      }
    };
    if (transaction) await apply(transaction);
    else {
      await this.db.transaction(apply);
      await this.changed(userId);
    }
    return eventId;
  }
  async commandResult(userId: string, deviceId: string, value: unknown) {
    await this.db.transaction(async (tx) => {
      await tx.lock(userId);
      const result = object(value);
      await this.result(
        tx,
        userId,
        deviceId,
        result,
        now(),
        `command:${id(result.commandId)}`,
      );
    });
    await this.changed(userId);
  }
}
