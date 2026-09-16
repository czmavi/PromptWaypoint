import type {
  CachedSession,
  ProfileMetadata,
  ServerDevice,
  ServerSnapshot,
  Session,
  Task,
} from "../../../../packages/core/main.ts";
import type { Database } from "../db/database.ts";
import { list } from "../repositories/store.ts";
export class Snapshots {
  constructor(
    private db: Database,
    private staleMs = 120000,
  ) {}
  async revision(userId: string): Promise<{ revision: string }> {
    // Include time-based transitions: an expired heartbeat or observation must
    // invalidate clients even when no server process was alive to write a row.
    const [row] = await this.db.query<{ revision: string }>(
      `
      WITH presence AS (
        SELECT id,coalesce(last_seen_at>now()-interval '45 seconds'
          AND sync_session_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM auth_tokens a WHERE a.hash=devices.sync_token_hash
            AND a.revoked_at IS NULL AND a.expires_at>now()),false) AS online
        FROM devices WHERE user_id=$1
      ) SELECT u.revision::text || ':' || md5(
        coalesce((SELECT string_agg(id || ':' || online::text,',' ORDER BY id) FROM presence),'') || ':' ||
        coalesce((SELECT string_agg(s.device_id || ':' || s.profile_id || ':' || s.id || ':' ||
          (NOT p.online OR s.observed_at<now()-$2::double precision*interval '1 millisecond')::text,','
          ORDER BY s.device_id,s.profile_id,s.id) FROM sessions s JOIN presence p ON p.id=s.device_id WHERE s.user_id=$1),'')
      ) AS revision FROM users u WHERE u.id=$1`,
      [userId, this.staleMs],
    );
    return { revision: row.revision };
  }
  read(userId: string): Promise<ServerSnapshot> {
    return this.db.transaction(async (tx) => {
      await tx.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const devices = (await tx.query<
        {
          id: string;
          user_id: string;
          name: string;
          platform: string;
          last_seen_at: Date | null;
          online: boolean;
        }
      >(
        "SELECT *, coalesce(last_seen_at>now()-interval '45 seconds' AND sync_session_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth_tokens a WHERE a.hash=devices.sync_token_hash AND a.revoked_at IS NULL AND a.expires_at>now()),false) AS online FROM devices WHERE user_id=$1",
        [userId],
      )).map((
        d,
      ): ServerDevice => ({
        id: d.id,
        userId: d.user_id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.last_seen_at?.toISOString(),
        online: d.online,
      }));
      const online = new Set(devices.filter((d) => d.online).map((d) => d.id));
      const sessions =
        (await tx.query<{ body: Session; device_id: string; expired: boolean }>(
          "SELECT body,device_id,observed_at<now()-$2::double precision*interval '1 millisecond' AS expired FROM sessions WHERE user_id=$1",
          [userId, this.staleMs],
        )).map(({ body, device_id, expired }): CachedSession => {
          const stale = !online.has(device_id) || expired;
          return {
            ...body,
            deviceId: device_id,
            stale,
            state: stale ? "unknown" : body.state,
          };
        });
      const profiles =
        (await list<ProfileMetadata>(tx, "provider_profiles", userId)).map((
          p,
        ) => ({
          ...p,
          available: online.has(p.deviceId) ? p.available : false,
        }));
      const tasks = (await list<Task>(tx, "tasks", userId)).sort((a, b) =>
        a.position - b.position || a.id.localeCompare(b.id)
      );
      const dependencies =
        (await tx.query<{ task_id: string; depends_on_id: string }>(
          "SELECT task_id,depends_on_id FROM task_dependencies WHERE user_id=$1",
          [userId],
        )).map((d) => ({ taskId: d.task_id, dependsOnId: d.depends_on_id }));
      return {
        devices,
        repositories: await list(tx, "repositories", userId),
        profiles,
        tasks,
        dependencies,
        executions: await list(tx, "executions", userId),
        sessions,
      };
    });
  }
}
