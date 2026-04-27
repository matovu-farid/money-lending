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

// postgres.js defaults are tuned for long-running Node servers, not for the
// serverless / edge-style Next.js workload here. The defaults to avoid:
//   - connect_timeout: 30s — network hiccups stall every request for 30s
//     before failing, which is what was producing the "Failed to get session"
//     30s hangs and CONNECT_TIMEOUT crashes seen in the logs.
//   - idle_timeout: 0 — idle conns linger forever and can be silently killed
//     by the upstream pooler/firewall, leaving us with broken sockets.
//   - max_lifetime: 30 min — too long for serverless; we'd rather recycle.
const isServerless = !!process.env.VERCEL || process.env.NODE_ENV === "production"

// In Next.js dev, HMR re-evaluates this module on every save. Without
// memoising the postgres client on `globalThis`, each reload creates a brand
// new connection pool and leaks the previous one — within a few minutes of
// editing we exhaust Neon's per-project connection cap, which then makes new
// TCP connects fail with CONNECT_TIMEOUT (visible as `POST /api/auth/sign-in/
// email 500 in 5.2s` after the connect_timeout above fires).
type Postgres = ReturnType<typeof postgres>
const globalForDb = globalThis as unknown as { __dbClient?: Postgres }

const client: Postgres =
  globalForDb.__dbClient ??
  postgres(connectionString, {
    ...(searchPath ? { connection: { search_path: searchPath } } : {}),
    // Fail fast on a hung TCP connect rather than blocking the whole request.
    connect_timeout: 5,
    // Drop sockets that have been idle long enough to risk being closed by an
    // intermediate pooler/firewall.
    idle_timeout: 20,
    // Recycle long-lived connections so we don't accumulate stale sockets.
    max_lifetime: 60 * 5,
    // Lower the pool ceiling on serverless — many short-lived instances each
    // holding 10 connections can exhaust the upstream Postgres limit.
    ...(isServerless ? { max: 5 } : {}),
  })

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbClient = client
}

export const db = drizzle(client, { schema })
