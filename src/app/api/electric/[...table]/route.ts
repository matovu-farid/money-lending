import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? "http://localhost:3001"
const ELECTRIC_SOURCE_SECRET = process.env.ELECTRIC_SECRET

/**
 * Tables that are allowed to be synced via Electric shapes.
 * Any table not in this set is rejected to prevent unauthorized data access.
 */
const ALLOWED_TABLES = new Set([
  "customers",
  "loans",
  "payments",
  "transactions",
  "creditors",
  "creditor_investments",
  "creditor_repayments",
  "bank_accounts",
  "invitation",
  "delegation",
  "notifications",
  "rate_change_requests",
  "fund_transfers",
  "collateral",
  "transaction_categories",
])

/**
 * Server-enforced column allowlists for tables with sensitive columns.
 * When a table is listed here, ONLY these columns are synced — regardless
 * of what the client requests. This prevents token/secret leaks.
 */
const SAFE_COLUMNS: Record<string, string> = {
  invitation: "id,email,name,role,status,invited_by,expires_at,created_at,accepted_at",
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string[] }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const { table: tableSegments } = await params
  const table = tableSegments.join("/")

  if (!ALLOWED_TABLES.has(table)) {
    return new Response(JSON.stringify({ error: "Table not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  const url = new URL(request.url)
  const originUrl = new URL(`${ELECTRIC_URL}/v1/shape`)

  // Forward only Electric protocol params (offset, handle, live, cursor, etc.)
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set the table server-side (never trust the client for table name)
  originUrl.searchParams.set("table", table)

  // Forward allowed filter params (where, columns, replica)
  const where = url.searchParams.get("where")
  if (where) originUrl.searchParams.set("where", where)

  // Enforce server-side column restrictions for sensitive tables
  const safeCols = SAFE_COLUMNS[table]
  if (safeCols) {
    originUrl.searchParams.set("columns", safeCols)
  } else {
    const columns = url.searchParams.get("columns")
    if (columns) originUrl.searchParams.set("columns", columns)
  }

  const replica = url.searchParams.get("replica")
  if (replica) originUrl.searchParams.set("replica", replica)

  // Attach the source secret if configured
  if (ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set("secret", ELECTRIC_SOURCE_SECRET)
  }

  const response = await fetch(originUrl.toString())

  // Copy response headers, removing encoding headers that break streaming
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete("content-encoding")
  responseHeaders.delete("content-length")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}
