import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.CYPRESS !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  const body = await request.json()
  const { task, params } = body as { task: string; params?: Record<string, string> }

  switch (task) {
    case "db:reset": {
      await db.execute(sql`
        TRUNCATE
          financial_snapshots,
          transactions,
          transaction_categories,
          creditor_repayments,
          creditor_investments,
          creditors,
          session,
          account,
          verification,
          audit_log,
          notifications,
          payments,
          collateral,
          loans,
          customers,
          system_settings,
          "user"
        CASCADE
      `)
      return NextResponse.json({ ok: true })
    }

    case "db:getUserRole": {
      const email = params?.email
      if (!email) return NextResponse.json({ error: "email required" }, { status: 400 })
      const rows = await db.execute(
        sql`SELECT role, email_verified FROM "user" WHERE email = ${email}`
      )
      const resultRows = rows as unknown as Array<{ role: string; email_verified: boolean }>
      if (resultRows.length === 0) return NextResponse.json(null)
      return NextResponse.json({
        role: resultRows[0].role,
        emailVerified: resultRows[0].email_verified,
      })
    }

    case "db:promoteUser": {
      const email = params?.email
      const role = params?.role
      if (!email || !role) return NextResponse.json({ error: "email and role required" }, { status: 400 })
      await db.execute(
        sql`UPDATE "user" SET role = ${role}, email_verified = true WHERE email = ${email}`
      )
      const users = await db.execute(
        sql`SELECT id FROM "user" WHERE email = ${email}`
      )
      const userRows = users as unknown as Array<{ id: string }>
      for (const u of userRows) {
        await db.execute(sql`DELETE FROM session WHERE user_id = ${u.id}`)
      }
      return NextResponse.json(null)
    }

    case "db:promoteUserKeepSession": {
      const email = params?.email
      const role = params?.role
      if (!email || !role) return NextResponse.json({ error: "email and role required" }, { status: 400 })
      await db.execute(
        sql`UPDATE "user" SET role = ${role}, email_verified = true WHERE email = ${email}`
      )
      return NextResponse.json(null)
    }

    case "db:getCustomers": {
      const rows = await db.execute(
        sql`SELECT id, full_name, contact, address, status FROM customers ORDER BY created_at DESC`
      )
      return NextResponse.json(rows)
    }

    case "db:getLoans": {
      const rows = await db.execute(
        sql`SELECT id, customer_id, principal_amount, interest_rate, status FROM loans ORDER BY created_at DESC`
      )
      return NextResponse.json(rows)
    }

    default:
      return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 })
  }
}
