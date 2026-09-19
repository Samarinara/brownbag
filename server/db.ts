import postgres from 'postgres';

export interface Database {
  query<T extends Record<string, any> = Record<string, any>>(
    text: string,
    params?: any[],
  ): Promise<T[]>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}

export function database(sql: postgres.Sql): Database {
  return {
    query: async (text, params = []) => [...(await sql.unsafe(text, params))] as any,
    transaction: (fn) =>
      sql.begin(async (tx) => fn(database(tx as unknown as postgres.Sql))) as Promise<any>,
  };
}

let connection: postgres.Sql | undefined;
export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required. Connect a Neon PostgreSQL database.');
  if (!connection)
    connection = postgres(url, {
      max: 2,
      prepare: false,
      idle_timeout: 10,
      connect_timeout: 10,
      max_lifetime: 60 * 5,
      // Neon connection strings include sslmode=require. Local PostgreSQL can use sslmode=disable.
    });
  return { sql: connection, db: database(connection) };
}
