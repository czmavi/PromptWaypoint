import type { Command } from "../../../../packages/protocol/main.ts";
import type { Database } from "../db/database.ts";
export class Dispatcher {
  constructor(private db: Database) {}
  pending(userId: string, deviceId: string): Promise<Command[]> {
    return this.db.transaction(async (tx) => {
      await tx.lock(userId);
      const rows = await tx.query<{ payload: Command }>(
        "SELECT payload FROM commands WHERE user_id=$1 AND device_id=$2 AND status IN ('pending','delivered','acknowledged') ORDER BY created_at LIMIT 1000",
        [userId, deviceId],
      );
      await tx.query(
        "UPDATE commands SET status='delivered' WHERE user_id=$1 AND device_id=$2 AND status='pending'",
        [userId, deviceId],
      );
      return rows.map((r) => r.payload);
    });
  }
  async ack(userId: string, deviceId: string, commandId: string) {
    await this.db.query(
      "UPDATE commands SET status='acknowledged' WHERE user_id=$1 AND device_id=$2 AND id=$3 AND status IN ('pending','delivered')",
      [userId, deviceId, commandId],
    );
  }
}
