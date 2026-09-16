import { id, strict } from "../../../../packages/protocol/main.ts";
import type {
  AgentSyncResponse,
  Command,
} from "../../../../packages/protocol/main.ts";
import type { Principal } from "../auth/auth.ts";
import type { Database, Transaction } from "../db/database.ts";
import type { Observations } from "../services/observations.ts";
import type { Scheduler } from "../tasks/scheduler.ts";
import { ApiError } from "../services/errors.ts";

export class AgentSync {
  constructor(
    private db: Database,
    private observations: Observations,
    private scheduler: Scheduler,
  ) {}

  private async authorize(tx: Transaction, p: Principal) {
    await tx.lock(p.userId);
    // Check again under the same lock used by token rotation/revocation.
    const rows = await tx.query(
      "SELECT hash FROM auth_tokens WHERE hash=$1 AND user_id=$2 AND device_id=$3 AND kind='device' AND revoked_at IS NULL AND expires_at>now()",
      [p.tokenHash, p.userId, p.deviceId],
    );
    if (!p.deviceId || !rows.length) throw new ApiError(401, "Unauthorized");
  }

  async connect(p: Principal, input: unknown): Promise<{ sessionId: string }> {
    const v = strict(input, [
      "sessionId",
      "generation",
      "device",
      "profiles",
      "repositories",
    ]);
    const sessionId = id(v.sessionId);
    const generation = v.generation;
    if (
      typeof generation !== "number" || !Number.isSafeInteger(generation) ||
      generation < 1
    ) throw new ApiError(400, "Invalid sync generation");
    return await this.db.transaction(async (tx) => {
      await this.authorize(tx, p);
      const [device] = await tx.query<
        {
          sync_session_id: string | null;
          sync_token_hash: string | null;
          sync_generation: string;
        }
      >(
        "SELECT sync_session_id,sync_token_hash,sync_generation FROM devices WHERE id=$1 AND user_id=$2",
        [p.deviceId, p.userId],
      );
      if (!device) throw new ApiError(403, "Device mismatch");
      if (generation <= Number(device.sync_generation)) {
        if (
          generation !== Number(device.sync_generation) ||
          device.sync_session_id !== sessionId ||
          device.sync_token_hash !== p.tokenHash
        ) {
          throw new ApiError(
            409,
            "Agent session superseded; restart or re-pair the agent",
          );
        }
        return { sessionId };
      }
      await this.observations.registration(p.userId, p.deviceId!, v, tx);
      await tx.query(
        "UPDATE devices SET sync_session_id=$3,sync_token_hash=$4,sync_generation=$5,sync_ready=false,last_seen_at=now() WHERE id=$1 AND user_id=$2",
        [p.deviceId, p.userId, sessionId, p.tokenHash, generation],
      );
      return { sessionId };
    });
  }

  async exchange(p: Principal, input: unknown): Promise<AgentSyncResponse> {
    const v = strict(input, ["sessionId", "events", "hasMore", "acknowledged"]);
    const sessionId = id(v.sessionId);
    if (
      typeof v.hasMore !== "boolean" || !Array.isArray(v.events) ||
      v.events.length > 100 || !Array.isArray(v.acknowledged) ||
      v.acknowledged.length > 100
    ) throw new ApiError(400, "Invalid sync batch");
    const events = v.events;
    const acknowledged = v.acknowledged.map(id);
    return await this.db.transaction(async (tx) => {
      await this.authorize(tx, p);
      const updated = await tx.query(
        "UPDATE devices SET last_seen_at=now(),sync_ready=false WHERE id=$1 AND user_id=$2 AND sync_session_id=$3 AND sync_token_hash=$4 RETURNING id",
        [p.deviceId, p.userId, sessionId, p.tokenHash],
      );
      if (!updated.length) {
        throw new ApiError(409, "Agent session superseded; restart the agent");
      }
      const eventIds: string[] = [];
      for (const event of events) {
        eventIds.push(
          await this.observations.event(p.userId, p.deviceId!, event, tx),
        );
      }
      if (acknowledged.length) {
        await tx.query(
          "UPDATE commands SET status='acknowledged' WHERE user_id=$1 AND device_id=$2 AND id=ANY($3::text[]) AND status IN ('pending','delivered')",
          [p.userId, p.deviceId, acknowledged],
        );
      }
      // Finish replaying the outbox before deciding whether a repository is idle.
      if (v.hasMore) {
        return {
          sessionId,
          eventIds,
          acknowledged,
          commands: [],
          pollAfterMs: 4000,
        };
      }
      await tx.query("UPDATE devices SET sync_ready=true WHERE id=$1", [
        p.deviceId,
      ]);
      await this.scheduler.tick(p.userId, tx);
      const commands = await tx.query<{ payload: Command }>(
        `WITH batch AS (
        SELECT id FROM commands WHERE user_id=$1 AND device_id=$2
        AND status IN ('pending','delivered','acknowledged')
        AND (delivered_at IS NULL OR delivered_at<now()-interval '30 seconds')
        ORDER BY created_at,id LIMIT 20 FOR UPDATE
      ), delivered AS (
        UPDATE commands c SET delivered_at=now(),status=CASE WHEN c.status='pending' THEN 'delivered' ELSE c.status END
        FROM batch WHERE c.id=batch.id RETURNING c.payload,c.created_at,c.id
      ) SELECT payload FROM delivered ORDER BY created_at,id`,
        [p.userId, p.deviceId],
      );
      return {
        sessionId,
        eventIds,
        acknowledged,
        commands: commands.map((c) => c.payload),
        pollAfterMs: 4000,
      };
    });
  }
}
