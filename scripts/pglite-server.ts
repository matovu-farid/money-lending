import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { readFileSync } from "fs"
import { join } from "path"

const PORT = 5488

let db: PGlite | null = null
let server: PGLiteSocketServer | null = null

interface JournalEntry { idx: number; tag: string }
interface Journal { entries: JournalEntry[] }

async function applyMigrations(db: PGlite) {
  await db.exec("CREATE SCHEMA IF NOT EXISTS test")
  await db.exec("SET search_path TO test, public")

  // Read the Drizzle journal to get the canonical ordered migration list.
  // This avoids applying orphaned/superseded SQL files in the drizzle/ dir.
  const drizzleDir = join(process.cwd(), "drizzle")
  const journal: Journal = JSON.parse(
    readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf-8")
  )
  const migrationFiles = journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map((e) => `${e.tag}.sql`)

  for (const file of migrationFiles) {
    let sql = readFileSync(join(drizzleDir, file), "utf-8")
    sql = sql.replace(/--> statement-breakpoint/g, "")
    sql = sql.replaceAll('"public".', '"test".')
    await db.exec(sql)
    console.log(`Applied: ${file}`)
  }
}

export async function startServer() {
  db = await PGlite.create()
  await applyMigrations(db)

  server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" })
  await server.start()
  console.log(`PGlite ready on port ${PORT}`)
}

export async function stopServer() {
  if (server) {
    await server.stop()
    server = null
  }
  if (db) {
    await db.close()
    db = null
  }
}

// Run standalone when executed directly (not imported)
const isDirectRun = process.argv[1]?.endsWith("pglite-server.ts")
  || process.argv[1]?.endsWith("pglite-server.js")

if (isDirectRun) {
  startServer().catch((err) => {
    console.error("PGlite server failed to start:", err)
    process.exit(1)
  })

  process.on("SIGINT", async () => {
    await stopServer()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    await stopServer()
    process.exit(0)
  })
}
