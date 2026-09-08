import type { User } from "../../../../packages/core/main.ts";
import type { Database, Transaction } from "../db/database.ts";
import { ApiError } from "../services/errors.ts";
export interface Principal {
  userId: string;
  deviceId?: string;
  tokenHash: string;
}
export interface AuthProvider {
  authenticate(token: string, kind: "client" | "device"): Promise<Principal>;
}
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function issue(
  tx: Transaction,
  userId: string,
  deviceId?: string,
): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((
    b,
  ) => b.toString(16).padStart(2, "0")).join("");
  await tx.query(
    "INSERT INTO auth_tokens(hash,user_id,device_id,kind,expires_at) VALUES($1,$2,$3,$4,$5)",
    [
      await digest(token),
      userId,
      deviceId ?? null,
      deviceId ? "device" : "client",
      new Date(Date.now() + (deviceId ? 365 : 30) * 86400000),
    ],
  );
  return token;
}
export class TokenAuth implements AuthProvider {
  constructor(private db: Database, private devSecret?: string) {}
  async authenticate(
    token: string,
    kind: "client" | "device",
  ): Promise<Principal> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, "Unauthorized");
    const hash = await digest(token);
    const [row] = await this.db.query<
      { user_id: string; device_id: string | null }
    >(
      "SELECT user_id,device_id FROM auth_tokens WHERE hash=$1 AND kind=$2 AND revoked_at IS NULL AND expires_at>now()",
      [hash, kind],
    );
    if (!row) throw new ApiError(401, "Unauthorized");
    return {
      userId: row.user_id,
      deviceId: row.device_id ?? undefined,
      tokenHash: hash,
    };
  }
  async login(secret: string): Promise<{ user: User; token: string }> {
    if (
      !this.devSecret || this.devSecret.length < 32 ||
      await digest(secret) !== await digest(this.devSecret)
    ) throw new ApiError(401, "Dev login unavailable or unauthorized");
    return this.db.transaction(async (tx) => {
      await tx.lock("dev-bootstrap");
      const user: User = { id: "dev-user", name: "Developer" };
      await tx.query(
        "INSERT INTO users(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
        [user.id, user.name],
      );
      return { user, token: await issue(tx, user.id) };
    });
  }
}
