import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

let connectionString =
  (process.env.CYPRESS === "true" ? process.env.DATABASE_URL_TEST : undefined) ??
  process.env.DATABASE_URL ??
  ""

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

const client = postgres(connectionString, {
  ...(searchPath ? { connection: { search_path: searchPath } } : {}),
})
export const db = drizzle(client, { schema })
