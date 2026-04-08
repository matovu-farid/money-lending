"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

export async function checkEmailExists(email: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM "user" WHERE LOWER("email") = LOWER(${email}) LIMIT 1`
  ) as unknown as Array<Record<string, unknown>>
  return rows.length > 0
}
