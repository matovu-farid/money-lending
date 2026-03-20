import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL ?? ""

// Extract search_path from URL if present (used for test schema isolation)
const url = connectionString ? new URL(connectionString) : null
const searchPath = url?.searchParams.get("search_path") ?? null

const client = postgres(connectionString, {
  ...(searchPath ? { connection: { search_path: searchPath } } : {}),
})
export const db = drizzle(client, { schema })
