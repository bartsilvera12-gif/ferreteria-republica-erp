import pg from "pg";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

let _pool: pg.Pool | null = null;

export function getChatPostgresConnectionString(): string | null {
  const u =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  return u && u.length > 0 ? u : null;
}

/** Pool Postgres directo (pooler) para chat en schemas no expuestos en PostgREST. */
export function getChatPostgresPool(): pg.Pool | null {
  const url = getChatPostgresConnectionString();
  if (!url) return null;
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return _pool;
}

export function quoteSchemaTable(schema: string, table: string): string {
  const s = assertAllowedChatDataSchema(schema);
  const t = table.replace(/[^\w]/g, "");
  if (!t) throw new Error("tabla inválida");
  return `"${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`;
}
