import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

/**
 * POST /api/test/create-user
 *
 * Creates a test user with the given role and returns session cookies.
 * If the user already exists (same email), creates a fresh session instead.
 * Uses better-auth's testUtils plugin — no password hashing, no rate limits.
 * Only available when CYPRESS=true.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.CYPRESS !== "true") {
    return NextResponse.json({ error: "Test endpoint disabled" }, { status: 403 })
  }

  const { name, email, role } = await request.json()
  const userEmail = email ?? `test-${Date.now()}@fidexa.org`

  const ctx = await auth.$context
  const test = ctx.test

  // Check if user already exists
  const existing = await db.execute(
    sql`SELECT id FROM "user" WHERE email = ${userEmail}`
  )
  const rows = existing as unknown as Array<{ id: string }>

  let userId: string

  if (rows.length > 0) {
    // User exists — just update role and create new session
    userId = rows[0].id
    if (role && role !== "unassigned") {
      await db.execute(
        sql`UPDATE "user" SET "role" = ${role} WHERE "id" = ${userId}`
      )
    }
  } else {
    // Create new user
    const user = test.createUser({
      name: name ?? "Test User",
      email: userEmail,
      emailVerified: true,
    })
    await test.saveUser(user)
    userId = user.id

    // Set the role (testUtils creates with defaultRole)
    if (role && role !== "unassigned") {
      await db.execute(
        sql`UPDATE "user" SET "role" = ${role} WHERE "id" = ${userId}`
      )
    }
  }

  // Get fresh session cookies
  const { cookies, session } = await test.login({ userId })

  return NextResponse.json({
    userId,
    email: userEmail,
    role: role ?? "unassigned",
    sessionToken: session.token,
    cookies,
  })
}
