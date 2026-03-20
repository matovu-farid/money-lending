import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { db } from "./db"
import { ac, superAdminRole, adminRole, loanOfficerRole, unassignedRole } from "./permissions"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // FIRST-USER BOOTSTRAP: If this is the very first user in the
          // database, promote them to superAdmin so the role hierarchy
          // can be bootstrapped without manual DB intervention.
          // The `user` table is managed by Better Auth. Use Drizzle's
          // raw `db` to count rows. At the point this hook fires the
          // newly created user already exists in the table, so count === 1
          // means this is the first user.
          const { sql } = await import("drizzle-orm")
          const result = await db.execute(sql`SELECT count(*)::int AS cnt FROM "user"`)
          const rows = result as unknown as Array<{ cnt: number }>
          const count = rows[0]?.cnt ?? 0

          if (Number(count) === 1) {
            // This is the first user -- promote to superAdmin.
            // Update directly via Drizzle since we are inside a databaseHook
            // and calling auth.api.setRole here could cause recursion or
            // require request headers we don't have.
            await db.execute(
              sql`UPDATE "user" SET "role" = 'superAdmin' WHERE "id" = ${user.id}`
            )
          }
        },
      },
    },
  },
  plugins: [
    admin({
      ac,
      roles: {
        superAdmin: superAdminRole,
        admin: adminRole,
        loanOfficer: loanOfficerRole,
        unassigned: unassignedRole,
      },
      defaultRole: "unassigned",
    }),
  ],
})
