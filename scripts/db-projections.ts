// scripts/db-projections.ts
// Applies every .sql file in drizzle/projections/ to the database in
// alphabetical filename order. Idempotent — safe to re-run.
//
// Wired into `postbuild` so projection triggers/functions are reapplied on
// every Vercel deploy alongside `drizzle-kit push`. Uses the `postgres` npm
// package (already a dep) rather than shelling to `psql`, so it works on
// Vercel build images where psql is not installed.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import postgres from "postgres"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("[db:projections] DATABASE_URL is required")
  process.exit(1)
}

const dir = join(process.cwd(), "drizzle", "projections")
let files: string[]
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
} catch (err) {
  console.error(`[db:projections] cannot read ${dir}:`, err)
  process.exit(1)
}

if (files.length === 0) {
  console.log("[db:projections] no projection files found; nothing to do")
  process.exit(0)
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    for (const file of files) {
      const path = join(dir, file)
      const stats = statSync(path)
      const source = readFileSync(path, "utf8")
      console.log(`[db:projections] applying ${file} (${stats.size} bytes)`)
      await sql.unsafe(source)
    }
    console.log(`[db:projections] applied ${files.length} file(s)`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error("[db:projections] failed:", err)
  process.exit(1)
})
