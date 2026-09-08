import postgres from "postgres";
export class Transaction {
  constructor(private sql: postgres.Sql | postgres.TransactionSql) {}
  async query<T = Record<string, unknown>>(
    query: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return await this.sql.unsafe(query, values as never[]) as unknown as T[];
  }
  async lock(userId: string) {
    await this.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      userId,
    ]);
  }
}
export class Database extends Transaction {
  private client: postgres.Sql;
  constructor(url: string) {
    const client = postgres(url, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 5,
      onnotice: () => {},
    });
    super(client);
    this.client = client;
  }
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return await this.client.begin((sql) => fn(new Transaction(sql))) as T;
  }
  async close() {
    await this.client.end({ timeout: 5 });
  }
}
