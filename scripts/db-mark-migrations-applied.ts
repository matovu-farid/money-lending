// scripts/db-mark-migrations-applied.ts
//
// PURPOSE
// -------
// One-shot reconciliation script used when switching from `drizzle-kit push`
// to `drizzle-kit migrate` on a database whose schema was previously created
// by `push` (or applied by hand). Both modes know nothing about each other:
// `push` mutates the schema directly and never writes to
// `drizzle.__drizzle_migrations`; `migrate` decides what to run by reading
// that table.
//
// Without seeding `__drizzle_migrations` first, the very next `drizzle-kit
// migrate` would try to re-run every numbered migration in `drizzle/` against
// a database whose tables already exist — at best erroring out, at worst
// duplicating seed data.
//
// This script reads `drizzle/meta/_journal.json` + every `<tag>.sql` file via
// the public `readMigrationFiles` export from `drizzle-orm/migrator` — the
// SAME function `drizzle-kit migrate` calls internally — so the `hash` values
// it inserts are guaranteed to match what migrate would compute. No
// hand-rolled hashing, no risk of silent re-runs on prod.
//
// WHEN TO USE
// -----------
// Once per database when migrating from `push` to `migrate`. After this runs,
// `drizzle-kit migrate` is a no-op until a new migration file is added.
//
// USAGE
// -----
//   DATABASE_URL=... pnpm db:mark-applied
//
// The script is idempotent — re-running it is safe (rows are matched on hash
// and skipped if already present).

import { readMigrationFiles } from "drizzle-orm/migrator"
import { join } from "node:path"
import postgres from "postgres"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("[db:mark-applied] DATABASE_URL is required")
  process.exit(1)
}

const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle")
const MIGRATIONS_SCHEMA = "drizzle"
const MIGRATIONS_TABLE = "__drizzle_migrations"

async function main() {
  // Public API — same call drizzle-kit makes internally.
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  if (migrations.length === 0) {
    console.log("[db:mark-applied] no migrations found in drizzle/; nothing to do")
    return
  }

  console.log(`[db:mark-applied] found ${migrations.length} migration(s) in ${MIGRATIONS_FOLDER}`)

  const sql = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    // Schema + table use the exact DDL drizzle-orm's migrator uses.
    // See node_modules/drizzle-orm/pg-core/dialect.js.
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`)
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)

    // Pull existing hashes so we can report skipped vs inserted.
    const existing = await sql<{ hash: string }[]>`
      select hash from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)}
    `
    const existingHashes = new Set(existing.map((r) => r.hash))

    let inserted = 0
    let skipped = 0

    for (const m of migrations) {
      if (existingHashes.has(m.hash)) {
        console.log(`  - skip (already applied): hash=${m.hash.slice(0, 12)}… when=${m.folderMillis}`)
        skipped += 1
        continue
      }
      await sql`
        insert into ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)} ("hash", "created_at")
        values (${m.hash}, ${m.folderMillis})
      `
      console.log(`  + mark applied:        hash=${m.hash.slice(0, 12)}… when=${m.folderMillis}`)
      inserted += 1
    }

    console.log(
      `[db:mark-applied] done — inserted ${inserted}, skipped ${skipped}, total in table now ${existing.length + inserted}`,
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error("[db:mark-applied] failed:", err)
  process.exit(1)
})
