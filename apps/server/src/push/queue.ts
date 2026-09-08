import type {
  Notification,
  PushRegistration,
} from "../../../../packages/core/main.ts";
import type { Database, Transaction } from "../db/database.ts";
import type { PushProvider } from "./providers.ts";
export async function enqueue(
  tx: Transaction,
  userId: string,
  key: string,
  notification: Notification,
) {
  await tx.query(
    "INSERT INTO push_jobs(id,user_id,registration_id,payload) SELECT $1||':'||id,user_id,id,$3::jsonb FROM push_devices WHERE user_id=$2 ON CONFLICT(id) DO NOTHING",
    [key, userId, notification],
  );
}
export class PushQueue {
  constructor(
    private db: Database,
    private providers: Partial<Record<"apns" | "fcm", PushProvider>>,
  ) {}
  async flush() {
    const jobs = await this.db.transaction(async (tx) => {
      const rows = await tx.query<
        {
          id: string;
          payload: Notification;
          registration_id: string;
          user_id: string;
        }
      >("SELECT * FROM push_jobs WHERE delivered_at IS NULL AND available_at<=now() ORDER BY available_at LIMIT 20 FOR UPDATE SKIP LOCKED");
      for (const row of rows) {
        await tx.query(
          "UPDATE push_jobs SET available_at=now()+interval '60 seconds' WHERE id=$1",
          [row.id],
        );
      }
      return rows;
    });
    for (const job of jobs) {
      const [row] = await this.db.query<
        { id: string; platform: "apns" | "fcm"; token: string }
      >(
        "SELECT id,platform,token FROM push_devices WHERE user_id=$1 AND id=$2",
        [job.user_id, job.registration_id],
      );
      if (!row) {
        await this.db.query("DELETE FROM push_jobs WHERE id=$1", [job.id]);
        continue;
      }
      const provider = this.providers[row.platform];
      if (!provider) continue;
      try {
        await provider.send(row as PushRegistration, job.payload);
        await this.db.query(
          "UPDATE push_jobs SET delivered_at=now() WHERE id=$1",
          [job.id],
        );
      } catch {
        await this.db.query(
          "UPDATE push_jobs SET attempts=attempts+1,available_at=now()+least(3600,power(2,least(attempts+1,11))) * interval '1 second' WHERE id=$1",
          [job.id],
        );
      }
    }
  }
}
