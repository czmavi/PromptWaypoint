import type { Task } from "../../../../packages/core/main.ts";
import type { Database, Transaction } from "../db/database.ts";
import { activeStates, Tasks } from "./tasks.ts";
export class Scheduler {
  constructor(
    private db: Database,
    private tasks: Tasks,
  ) {}
  tick(userId: string, transaction?: Transaction) {
    const apply = async (tx: Transaction) => {
      await tx.lock(userId);
      const devices = await tx.query<{ id: string }>(
        "SELECT id FROM devices WHERE user_id=$1 AND last_seen_at>now()-interval '45 seconds' AND sync_ready AND sync_session_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth_tokens a WHERE a.hash=devices.sync_token_hash AND a.revoked_at IS NULL AND a.expires_at>now())",
        [userId],
      );
      const online = new Set(devices.map((d) => d.id));
      const rows = await tx.query<{ body: Task; device_id: string }>(
        "SELECT t.body,r.device_id FROM tasks t JOIN repositories r ON r.id=t.repository_id WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.body->>'status'='queued' ORDER BY (t.body->>'priority')::numeric DESC,(t.body->>'position')::numeric,t.id",
        [userId],
      );
      let dispatched = false;
      for (const row of rows) {
        if (
          !online.has(row.device_id) ||
          await this.tasks.blocked(tx, row.body.id)
        ) continue;
        const busy = await tx.query(
          "SELECT id FROM executions WHERE user_id=$1 AND body->>'repositoryId'=$2 AND body->>'state'=ANY($3::text[]) LIMIT 1",
          [userId, row.body.repositoryId, activeStates],
        );
        if (busy.length) continue;
        const external = await tx.query(
          "SELECT id FROM sessions WHERE user_id=$1 AND body->>'repositoryId'=$2 AND body->>'state'='running' AND observed_at>now()-interval '120 seconds' LIMIT 1",
          [userId, row.body.repositoryId],
        );
        if (external.length) continue;
        const profileId = row.body.providerProfileId;
        const profile = await tx.query(
          "SELECT p.id FROM provider_profiles p JOIN repositories r ON r.device_id=p.device_id WHERE r.id=$1 AND p.id=coalesce($2,r.body->>'defaultProviderProfileId') AND coalesce(p.body->>'available','true')<>'false'",
          [row.body.repositoryId, profileId ?? null],
        );
        if (!profile.length) continue;
        await this.tasks.action(tx, userId, row.body.id, { action: "run" });
        dispatched = true;
      }
      return dispatched;
    };
    return transaction ? apply(transaction) : this.db.transaction(apply);
  }
}
