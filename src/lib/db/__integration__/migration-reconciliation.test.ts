// src/lib/db/__integration__/migration-reconciliation.test.ts
//
// Verifies scripts/db-mark-migrations-applied.ts against a real Postgres
// server. The test creates a throwaway database on the local Postgres
// pointed to by DATABASE_URL_TEST, runs the reconciliation script against
// it, and asserts that the rows it writes match what drizzle-orm's public
// `readMigrationFiles` API produces.
//
// Why DATABASE_URL_TEST (local pg) and not DATABASE_URL (Neon):
//   - Neon dev databases are stateful and shared; CREATE DATABASE there is
//     wasteful and the cleanup is fiddly.
//   - The whole point of this test is to prove the script is correct against
//     an isolated DB, exactly mirroring what we will do on prod.
//
// If DATABASE_URL_TEST is not set or local Postgres is unreachable the test
// is skipped — same convention as the rest of the integration suite, which
// already requires a running database.

import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { readMigrationFiles } from "drizzle-orm/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const TEST_URL_BASE = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL_TEST_UNPOOLED

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "db-mark-migrations-applied.ts")
const MIGRATIONS_FOLDER = join(REPO_ROOT, "drizzle")

// Skip the suite entirely if local Postgres isn't configured. This keeps
// CI green when only Neon is available and matches the rest of the
// integration suite, which presumes a reachable DB.
const skip = !TEST_URL_BASE
const d = skip ? describe.skip : describe

d("migration-reconciliation (integration)", () => {
  const dbName = `mig_recon_test_${randomBytes(4).toString("hex")}`
  let throwawayUrl: string

  beforeAll(async () => {
    // Connect to the default `postgres` maintenance DB to issue CREATE DATABASE.
    const adminUrl = new URL(TEST_URL_BASE!)
    adminUrl.pathname = "/postgres"
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
    try {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`)
    } finally {
      await admin.end({ timeout: 5 })
    }
    const child = new URL(TEST_URL_BASE!)
    child.pathname = `/${dbName}`
    throwawayUrl = child.toString()
  }, 30_000)

  afterAll(async () => {
    if (!throwawayUrl) return
    const adminUrl = new URL(TEST_URL_BASE!)
    adminUrl.pathname = "/postgres"
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
    try {
      // Drop with FORCE so any leftover connection from the script doesn't block us.
      await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, 30_000)

  it("populates __drizzle_migrations with hashes that match drizzle-orm's readMigrationFiles", async () => {
    // Run the actual script as a child process — proves the wired-up behaviour,
    // not a re-implementation.
    const result = spawnSync("pnpm", ["tsx", SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: throwawayUrl },
      encoding: "utf8",
    })
    expect(result.status, `script failed: ${result.stderr || result.stdout}`).toBe(0)

    const expected = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
    expect(expected.length).toBeGreaterThan(0)

    const client = postgres(throwawayUrl, { max: 1, onnotice: () => {} })
    try {
      const rows = await client<{ hash: string; created_at: string }[]>`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by id asc
      `

      // 1. Every journal entry must have a row.
      expect(rows.length).toBe(expected.length)

      // 2. Every journal hash must be present in the table (set equality).
      const dbHashes = new Set(rows.map((r) => r.hash))
      const expectedHashes = new Set(expected.map((m) => m.hash))
      expect(dbHashes).toEqual(expectedHashes)

      // 3. created_at must equal folderMillis (the journal `when`).
      const dbByHash = new Map(rows.map((r) => [r.hash, BigInt(r.created_at)]))
      for (const m of expected) {
        expect(dbByHash.get(m.hash)).toBe(BigInt(m.folderMillis))
      }
    } finally {
      await client.end({ timeout: 5 })
    }
  }, 60_000)

  it("is idempotent — re-running the script inserts nothing new", async () => {
    const before = await countRows(throwawayUrl)
    const result = spawnSync("pnpm", ["tsx", SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: throwawayUrl },
      encoding: "utf8",
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    const after = await countRows(throwawayUrl)
    expect(after).toBe(before)
    expect(result.stdout).toMatch(/skip \(already applied\)/)
  }, 60_000)

  it("renders drizzle-kit migrate a no-op against a reconciled database", async () => {
    // After reconciliation, drizzle-kit migrate should not run anything.
    // We assert no-op by snapshotting the application table list before and
    // after, AND by checking the migrations table row count is unchanged.
    //
    // Note: the throwaway DB has NO application tables (the script doesn't
    // create them). The invariant we care about is that `migrate` doesn't
    // start creating tables either — because the journal entries are all
    // marked as applied (their folderMillis <= last created_at in the table).
    // See node_modules/drizzle-orm/pg-core/dialect.js: migrate skips entries
    // where lastDbMigration.created_at >= migration.folderMillis.
    const beforeRows = await countRows(throwawayUrl)
    const beforeTables = await listPublicTables(throwawayUrl)

    const result = spawnSync(
      "pnpm",
      ["exec", "drizzle-kit", "migrate"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: throwawayUrl },
        encoding: "utf8",
      },
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)

    const afterRows = await countRows(throwawayUrl)
    const afterTables = await listPublicTables(throwawayUrl)

    expect(afterRows).toBe(beforeRows)
    expect(afterTables).toEqual(beforeTables)
  }, 120_000)
})

async function countRows(url: string): Promise<number> {
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const rows = await client<{ count: string }[]>`
      select count(*)::text as count from drizzle.__drizzle_migrations
    `
    return Number(rows[0].count)
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function listPublicTables(url: string): Promise<string[]> {
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const rows = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `
    return rows.map((r) => r.table_name)
  } finally {
    await client.end({ timeout: 5 })
  }
}
