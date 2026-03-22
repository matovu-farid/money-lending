import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

// Use unpooled test DB for Cypress (pooled pgbouncer does not support
// SET search_path or the options startup parameter on Neon).
let connectionString =
  (process.env.CYPRESS === "true" && process.env.DATABASE_URL_TEST_UNPOOLED)
    ? process.env.DATABASE_URL_TEST_UNPOOLED
    : (process.env.CYPRESS === "true" && process.env.DATABASE_URL_TEST)
      ? process.env.DATABASE_URL_TEST
      : (process.env.DATABASE_URL ?? "")

// Extract search_path from URL params and apply via postgres.js connection options
let searchPath: string | undefined
if (connectionString) {
  const url = new URL(connectionString)
  const sp = url.searchParams.get("search_path")
  if (sp) {
    searchPath = sp
    url.searchParams.delete("search_path")
    connectionString = url.toString()
  }
}

const isTest = process.env.CYPRESS === "true"

const client = postgres(connectionString, {
  ...(searchPath ? { connection: { search_path: searchPath } } : {}),
  // Force single connection in test mode so every query (including inside
  // db.transaction()) uses the same connection with search_path applied.
  // Neon's pgbouncer doesn't propagate SET commands across pool connections.
  ...(isTest ? { max: 1 } : {}),
})
export const db = drizzle(client, { schema })
