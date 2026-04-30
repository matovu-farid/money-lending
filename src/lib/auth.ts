import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, testUtils } from "better-auth/plugins"
import { Resend } from "resend"
import { db } from "./db"
import { ac, superAdminRole, adminRole, supervisorRole, loanOfficerRole, unassignedRole } from "./permissions"
import { VerifyEmailTemplate, ResetPasswordTemplate } from "@/lib/emails"

// In-memory store for Cypress E2E tests: maps email -> verification URL
// Only populated when NODE_ENV=test (sendVerificationEmail stores URL here instead of emailing)
export const pendingVerifications = new Map<string, string>()

const isTest = process.env.NODE_ENV === "test" || process.env.CYPRESS === "true"
const isCypress = process.env.CYPRESS === "true"

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

const emailFrom = process.env.EMAIL_FROM || "Kaks Credit <noreply@fidexa.org>"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  // Disable rate limiting in test/Cypress mode to prevent 429s
  ...(isCypress ? { rateLimit: { enabled: false } } : {}),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: !isTest,
    sendResetPassword: async ({ user, url }) => {
      if (isTest) return // skip in test
      await getResend().emails.send({
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
      console.log("[Email Debug] sendVerificationEmail called", {
        email: user.email,
        isTest,
        isCypress,
        NODE_ENV: process.env.NODE_ENV,
        CYPRESS: process.env.CYPRESS,
      })
      if (isTest || isCypress) {
        console.log("[Email Debug] SKIPPED — isTest or isCypress is true")
        // Store URL for Cypress test retrieval via /api/test/verification-url
        pendingVerifications.set(user.email, url)
        return
      }

      // Skip for invited users — their email gets verified directly during acceptance
      const { sql } = await import("drizzle-orm")
      const inviteRows = await db.execute(
        sql`SELECT 1 FROM "invitation" WHERE "email" = ${user.email} AND "status" = 'pending' LIMIT 1`
      )
      if ((inviteRows as unknown as any[]).length > 0) {
        console.log("[Email Debug] SKIPPED — user has pending invitation")
        return
      }

      console.log("[Email Debug] Proceeding to send email via Resend")
      try {
        const result = await getResend().emails.send({
          from: emailFrom,
          to: user.email,
          subject: "Verify your email address",
          react: VerifyEmailTemplate({ url }),
        })
        console.log("[Email Debug] Resend response:", JSON.stringify(result))
      } catch (err) {
        console.error("[Email Debug] Resend error:", err)
      }
    },
  },
  session: {
    // Per better-auth docs (Optimizing for Performance), enabling cookieCache
    // makes `auth.api.getSession({ headers })` validate a signed `session_data`
    // cookie cryptographically and skip the database entirely. Without it,
    // every middleware hit, every Electric long-poll, every API route does a
    // session SELECT on the user/session tables — which is what was producing
    // the CONNECT_TIMEOUT bursts and pool exhaustion.
    //
    // Trade-off: revoked/banned sessions can stay live for up to `maxAge`
    // before the cache expires and the next `getSession` re-checks the DB.
    // 5 minutes is the better-auth-recommended default.
    cookieCache: {
      enabled: true,
      maxAge: 15 * 60,
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
          // Atomic check-and-update: promotes to superAdmin only if no other
          // user exists, avoiding a race condition where two concurrent
          // registrations on a fresh database both skip promotion.
          await db.execute(sql`
            UPDATE "user" SET "role" = 'superAdmin'
            WHERE "id" = ${user.id}
              AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" != ${user.id})
          `)
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          // Record admin/superAdmin login IPs in the trusted allowlist.
          // Wrapped so a failure here never breaks login.
          try {
            if (!session.ipAddress) return
            const { sql } = await import("drizzle-orm")
            const rows = await db.execute(
              sql`SELECT "role" FROM "user" WHERE "id" = ${session.userId}`
            )
            const role = (rows as unknown as Array<{ role: string | null }>)[0]?.role
            if (role !== "admin" && role !== "superAdmin") return
            const { recordAdminLoginIp } = await import("@/lib/ip-allowlist")
            await recordAdminLoginIp(session.userId, session.ipAddress)
          } catch (err) {
            console.warn("[auth] session.create.after IP capture failed", err)
          }
        },
      },
    },
  },
  plugins: [
    ...(isTest ? [testUtils()] : []),
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
