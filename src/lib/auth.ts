import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { Resend } from "resend"
import { db } from "./db"
import { ac, superAdminRole, adminRole, supervisorRole, loanOfficerRole, unassignedRole } from "./permissions"
import { VerifyEmailTemplate, ResetPasswordTemplate } from "@/lib/emails"

// In-memory store for Cypress E2E tests: maps email -> verification URL
// Only populated when NODE_ENV=test (sendVerificationEmail stores URL here instead of emailing)
export const pendingVerifications = new Map<string, string>()

const isTest = process.env.NODE_ENV === "test" || process.env.CYPRESS === "true"
const isCypress = process.env.CYPRESS === "true"

const resend = new Resend(process.env.RESEND_API_KEY)
const emailFrom = process.env.EMAIL_FROM || "Lending Manager <noreply@fidexa.org>"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: !isTest,
    sendResetPassword: async ({ user, url }) => {
      if (isTest) return // skip in test
      await resend.emails.send({
        from: emailFrom,
        to: user.email,
        subject: "Reset your password",
        react: ResetPasswordTemplate({ url }),
      })
    },
  },
  emailVerification: {
    sendOnSignUp: !isTest,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (isTest || isCypress) {
        // Store URL for Cypress test retrieval via /api/test/verification-url
        pendingVerifications.set(user.email, url)
        return
      }
      await resend.emails.send({
        from: emailFrom,
        to: user.email,
        subject: "Verify your email address",
        react: VerifyEmailTemplate({ url }),
      })
    },
  },
  session: {
    cookieCache: {
      enabled: false,
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
        supervisor: supervisorRole,
        loanOfficer: loanOfficerRole,
        unassigned: unassignedRole,
      },
      defaultRole: "unassigned",
    }),
  ],
})
