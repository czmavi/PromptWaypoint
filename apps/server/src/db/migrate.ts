import { Database } from "./database.ts";
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    await tx.lock("pmai:migrations");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const version of ["001_control_plane", "002_retained_history"]) {
      if (
        !(await tx.query(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [version],
        )).length
      ) {
        await tx.query(
          await Deno.readTextFile(
            new URL(`./migrations/${version}.sql`, import.meta.url),
          ),
        );
        await tx.query("INSERT INTO schema_migrations(version) VALUES($1)", [
          version,
        ]);
      }
    }
  });
}
if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL required");
  const db = new Database(url);
  try {
    await migrate(db);
    console.log("Migrations applied");
  } finally {
    await db.close();
  }
}
