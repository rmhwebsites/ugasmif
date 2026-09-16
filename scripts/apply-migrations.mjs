// Applies supabase/migrations/*.sql to the linked project.
//
// Two paths, tried in order:
//   1. SUPABASE_DB_URL (direct Postgres) via psql when available.
//   2. Supabase Management API (needs SUPABASE_ACCESS_TOKEN, an sbp_... token
//      from https://supabase.com/dashboard/account/tokens) — works from
//      environments that only allow HTTPS.
//
// Tracks applied migrations in a schema_migrations table so reruns are safe.
//
// Usage: node scripts/apply-migrations.mjs [--dry-run]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const MIGRATIONS_DIR = "supabase/migrations";
const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF ??
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(
    /https:\/\/([a-z0-9]+)\.supabase\.co/
  )?.[1];

// Load .env.local when run outside Next
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const dryRun = process.argv.includes("--dry-run");

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

const TRACKING_SQL = `
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
`;

async function runViaManagementApi(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

function runViaPsql(sql) {
  return execFileSync(
    "psql",
    [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-X", "-q"],
    { input: sql, encoding: "utf8", timeout: 120_000 }
  );
}

async function main() {
  const migrations = listMigrations();
  if (migrations.length === 0) {
    console.log("No migrations found in", MIGRATIONS_DIR);
    return;
  }

  let run;
  if (process.env.SUPABASE_DB_URL) {
    try {
      runViaPsql("select 1;");
      run = (sql) => Promise.resolve(runViaPsql(sql));
      console.log("Using direct Postgres connection.");
    } catch {
      console.log("Direct Postgres unreachable, trying Management API…");
    }
  }
  if (!run) {
    if (!process.env.SUPABASE_ACCESS_TOKEN || !PROJECT_REF) {
      console.error(
        "Cannot reach the database.\n" +
          "Set SUPABASE_DB_URL (with psql installed and port 5432 reachable),\n" +
          "or set SUPABASE_ACCESS_TOKEN (sbp_… from supabase.com/dashboard/account/tokens)\n" +
          "so migrations can go through the HTTPS Management API."
      );
      process.exit(1);
    }
    run = runViaManagementApi;
    console.log("Using Supabase Management API over HTTPS.");
  }

  await run(TRACKING_SQL);
  const appliedRes = await run("select name from public.schema_migrations;");
  const applied = new Set(
    (Array.isArray(appliedRes) ? appliedRes : [])
      .map((r) => r.name)
      .filter(Boolean)
  );

  for (const m of migrations) {
    if (applied.has(m.name)) {
      console.log(`skip  ${m.name} (already applied)`);
      continue;
    }
    if (dryRun) {
      console.log(`would apply ${m.name} (${m.sql.length} bytes)`);
      continue;
    }
    console.log(`apply ${m.name} …`);
    await run(m.sql);
    await run(
      `insert into public.schema_migrations (name) values ('${m.name.replace(/'/g, "''")}') on conflict do nothing;`
    );
    console.log(`done  ${m.name}`);
  }
  console.log("All migrations applied.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
