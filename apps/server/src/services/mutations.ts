import type { Database, Transaction } from "../db/database.ts";
import { digest } from "../auth/auth.ts";
import { ApiError } from "./errors.ts";
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${
      Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) =>
        `${JSON.stringify(k)}:${canonical(v)}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(v);
}
export class Mutations {
  constructor(
    private db: Database,
    private changed: (userId: string) => Promise<void>,
  ) {}
  async run<T>(
    userId: string,
    key: string,
    request: unknown,
    operation: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(key)) {
      throw new ApiError(400, "Idempotency-Key required");
    }
    const hash = await digest(canonical(request));
    const result = await this.db.transaction(async (tx) => {
      await tx.lock(userId);
      const [existing] = await tx.query<{ fingerprint: string; response: T }>(
        "SELECT fingerprint,response FROM mutation_journal WHERE user_id=$1 AND id=$2",
        [userId, key],
      );
      if (existing) {
        if (existing.fingerprint !== hash) {
          throw new ApiError(
            409,
            "Idempotency key reused with another request",
          );
        }
        return existing.response;
      }
      const response = await operation(tx);
      await tx.query(
        "INSERT INTO mutation_journal(user_id,id,fingerprint,response) VALUES($1,$2,$3,$4::jsonb)",
        [userId, key, hash, response],
      );
      return response;
    });
    await this.changed(userId);
    return result;
  }
}
