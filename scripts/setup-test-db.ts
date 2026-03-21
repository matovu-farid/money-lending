import "dotenv/config"
import postgres from "postgres"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const url = process.env.DATABASE_URL_TEST_UNPOOLED
if (!url) {
  console.error("DATABASE_URL_TEST_UNPOOLED is not set")
  process.exit(1)
}

const baseUrl = url.replace(/&search_path=test/, "")
const sql = postgres(baseUrl)

async function setup() {
  console.log("Dropping and recreating test schema...")
  await sql.unsafe("DROP SCHEMA IF EXISTS test CASCADE")
  await sql.unsafe("CREATE SCHEMA test")

  // Read ALL migration SQL files and adapt for test schema
  const drizzleDir = join(process.cwd(), "drizzle")
  const migrationFiles = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  await sql.unsafe("SET search_path TO test, public")

  for (const file of migrationFiles) {
    const migrationPath = join(drizzleDir, file)
    let migrationSql = readFileSync(migrationPath, "utf-8")

    // Remove statement breakpoint comments
    migrationSql = migrationSql.replace(/--> statement-breakpoint/g, "")

    // Replace "public". schema qualifier with "test".
    migrationSql = migrationSql.replaceAll('"public".', '"test".')

    await sql.unsafe(migrationSql)
    console.log(`Applied: ${file}`)
  }

  await sql.unsafe("SET search_path TO public")

  // Verify
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'test'
    ORDER BY table_name
  `
  console.log("Tables created:", tables.map((r: Record<string, string>) => r.table_name))

  await sql.end()
  console.log("Test database ready.")
}

setup().catch((err) => {
  console.error(err)
  process.exit(1)
})
