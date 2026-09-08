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
    private online: (device: string) => boolean,
    private staleMs = 120000,
  ) {}
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
        }
      >("SELECT * FROM devices WHERE user_id=$1", [userId])).map((
        d,
      ): ServerDevice => ({
        id: d.id,
        userId: d.user_id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.last_seen_at?.toISOString(),
        online: this.online(d.id),
      }));
      const sessions = (await tx.query<{ body: Session; device_id: string }>(
        "SELECT body,device_id FROM sessions WHERE user_id=$1",
        [userId],
      )).map(({ body, device_id }): CachedSession => {
        const stale = !this.online(device_id) ||
          Date.now() - Date.parse(body.observedAt) > this.staleMs;
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
          available: this.online(p.deviceId) ? p.available : false,
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
