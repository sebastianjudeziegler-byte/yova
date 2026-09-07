// Optional integration check. Install embedded-postgres and pg in a temporary
// runtime directory, then pass its package.json as YOVA_LOCAL_PG_RUNTIME.
// No production credentials or database connections are accepted.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const runtimePath = process.env.YOVA_LOCAL_PG_RUNTIME;
if (!runtimePath) throw new Error("Set YOVA_LOCAL_PG_RUNTIME to the temporary test runtime's package.json.");
const runtime = createRequire(resolve(runtimePath));
const { default: EmbeddedPostgres } = await import(runtime.resolve("embedded-postgres"));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseDir = await mkdtemp(resolve(tmpdir(), "yova-launch-db-"));
const port = Number(process.env.YOVA_LOCAL_PG_PORT ?? 55440);
const postgres = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "local-yova-test-only", persistent: false, postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
let started = false;
try {
  await postgres.initialise();
  await postgres.start();
  started = true;
  const admin = postgres.getPgClient();
  await admin.connect();
  await admin.query("create database yova_utf8 with encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'");
  await admin.end();
  const client = postgres.getPgClient("yova_utf8");
  await client.connect();
  try {
    await client.query(`create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
DO $$ BEGIN create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; EXCEPTION WHEN duplicate_object THEN null; END $$;
create extension if not exists pgcrypto with schema extensions;
create table if not exists auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
create or replace function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
create table if not exists public.local_test_migrations(name text primary key);`);
    await client.query("alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column last_sign_in_at timestamptz;");
    const directory = resolve(root, "supabase/migrations");
    const migrations = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
    for (const name of migrations) {
      await client.query("begin");
      try {
        await client.query(await readFile(resolve(directory, name), "utf8"));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration failed: ${name}`, { cause: error });
      }
    }
    console.log(`Applied ${migrations.length} migrations to an isolated local database.`);
  } finally { await client.end(); }
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/evals/launch-database.local.test.ts", "--reporter=verbose"], {
      cwd: root, stdio: "inherit", env: { ...process.env, YOVA_LOCAL_PG_MODULE: runtime.resolve("pg"), YOVA_LOCAL_PG_PORT: String(port) },
    });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
} finally {
  if (started) await postgres.stop();
  await rm(databaseDir, { recursive: true, force: true });
}
