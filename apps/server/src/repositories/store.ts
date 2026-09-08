import type { Transaction } from "../db/database.ts";
import { ApiError } from "../services/errors.ts";
export type BodyTable = "tasks" | "repositories" | "executions";
export async function get<T>(
  tx: Transaction,
  table: BodyTable,
  userId: string,
  id: string,
): Promise<T> {
  const [row] = await tx.query<{ body: T }>(
    `SELECT body FROM ${table} WHERE user_id=$1 AND id=$2 ${
      table === "tasks" ? "AND deleted_at IS NULL" : ""
    }`,
    [userId, id],
  );
  if (!row) throw new ApiError(404, "Not found");
  return row.body;
}
export async function list<T>(
  tx: Transaction,
  table: BodyTable | "provider_profiles" | "sessions",
  userId: string,
): Promise<T[]> {
  return (await tx.query<{ body: T }>(
    `SELECT body FROM ${table} WHERE user_id=$1 ${
      table === "tasks" ? "AND deleted_at IS NULL" : ""
    }`,
    [userId],
  )).map((r) => r.body);
}
export async function save(
  tx: Transaction,
  table: BodyTable,
  userId: string,
  id: string,
  body: unknown,
) {
  await tx.query(
    `UPDATE ${table} SET body=$3::jsonb WHERE user_id=$1 AND id=$2 ${
      table === "tasks" ? "AND deleted_at IS NULL" : ""
    }`,
    [userId, id, body],
  );
}
