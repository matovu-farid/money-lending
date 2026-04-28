// scripts/db-projections.ts
// Applies every .sql file in drizzle/projections/ to the database in
// alphabetical filename order. Idempotent — safe to re-run.

import { spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

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

for (const file of files) {
  const path = join(dir, file)
  const stats = statSync(path)
  console.log(`[db:projections] applying ${file} (${stats.size} bytes)`)
  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", path], {
    stdio: "inherit",
  })
  if (result.status !== 0) {
    console.error(`[db:projections] psql exited ${result.status} for ${file}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`[db:projections] applied ${files.length} file(s)`)
