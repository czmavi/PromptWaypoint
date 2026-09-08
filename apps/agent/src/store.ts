import { DatabaseSync } from "node:sqlite";
import { type Device, now } from "../../../packages/core/main.ts";
import type { AgentEvent } from "../../../packages/protocol/main.ts";
export type Table =
  | "metadata"
  | "repositories"
  | "profiles"
  | "sessions"
  | "executions"
  | "commands"
  | "reconciliation"
  | "outbox";
export class Store {
  db: DatabaseSync;
  device: Device;
  constructor(path: string, name = "Local device") {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    for (
      const table of [
        "metadata",
        "repositories",
        "profiles",
        "sessions",
        "executions",
        "commands",
        "reconciliation",
        "outbox",
      ]
    ) {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
    }
    this.device = this.get<Device>("metadata", "device") ??
      { id: crypto.randomUUID(), name, platform: Deno.build.os };
    this.put("metadata", "device", this.device);
    this.put("metadata", "schemaVersion", 1);
  }
  get<T>(table: Table, id: string): T | undefined {
    const row = this.db.prepare(`SELECT value FROM ${table} WHERE id = ?`).get(
      id,
    );
    return row ? JSON.parse(row.value as string) : undefined;
  }
  all<T>(table: Table): T[] {
    return this.db.prepare(`SELECT value FROM ${table} ORDER BY rowid`).all()
      .map((r) => JSON.parse(r.value as string));
  }
  put(table: Table, id: string, value: unknown) {
    this.db.prepare(
      `INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
    ).run(id, JSON.stringify(value));
  }
  remove(table: Table, id: string) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  event(type: string, data: unknown): AgentEvent {
    const event = {
      id: crypto.randomUUID(),
      deviceId: this.device.id,
      type,
      at: now(),
      data,
    };
    this.put("outbox", event.id, event);
    return event;
  }
  close() {
    this.db.close();
  }
}
