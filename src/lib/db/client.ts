import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Database access. Two backends speaking the same SQL:
 *  - DATABASE_URL set → node-postgres (e.g. Supabase Postgres connection string; server-side only).
 *  - otherwise      → PGlite (real PostgreSQL compiled to WASM) persisted in ./data/pglite.
 *    Zero setup for local use. Not suitable for serverless hosting (needs a persistent disk).
 * Migrations in supabase/migrations are applied in order and tracked in schema_migrations.
 */
export interface Db {
  kind: "pglite" | "postgres";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement script (no parameters). */
  exec(sql: string): Promise<void>;
}

const LOCAL_AUTH_STUB = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
`;

const g = globalThis as unknown as { __oiDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__oiDb ??= openDb().catch((e) => {
    g.__oiDb = undefined;
    throw e;
  });
  return g.__oiDb;
}

export async function openDb(opts: { databaseUrl?: string; pgliteDir?: string; migrationsDir?: string } = {}): Promise<Db> {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 5 });
    db = {
      kind: "postgres",
      query: async (sql, params) => ({ rows: (await pool.query(sql, params as unknown[])).rows }),
      exec: async (sql) => void (await pool.query(sql)),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = opts.pgliteDir ?? process.env.PGLITE_DIR ?? path.join(process.cwd(), "data", "pglite");
    let pg: InstanceType<typeof PGlite>;
    if (dir === "memory://") pg = new PGlite();
    else {
      mkdirSync(dir, { recursive: true });
      pg = new PGlite(dir);
    }
    await pg.waitReady;
    db = {
      kind: "pglite",
      query: async (sql, params) => ({ rows: (await pg.query(sql, params as unknown[])).rows as never }),
      exec: async (sql) => void (await pg.exec(sql)),
    };
    await db.exec(LOCAL_AUTH_STUB);
  }
  await migrate(db, opts.migrationsDir ?? path.join(process.cwd(), "supabase", "migrations"));
  return db;
}

async function migrate(db: Db, dir: string) {
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>(`select name from schema_migrations`)).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.exec(`begin;\n${readFileSync(path.join(dir, f), "utf8")}\ninsert into schema_migrations (name) values ('${f.replace(/'/g, "''")}');\ncommit;`);
  }
}
