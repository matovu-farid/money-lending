import { getSession, checkPermission, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { Effect } from "effect"
import type { Permission } from "@/types"
import { headers } from "next/headers"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
import { captureServerError, isExpectedDomainError } from "@/lib/sentry"

/** The session type returned by getSession() when non-null. */
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>

// ---------------------------------------------------------------------------
// Classic mode interfaces
// ---------------------------------------------------------------------------

interface ActionOptionsWithInput<TInput, TResult> {
  permission?: Permission
  forbiddenMessage?: string
  action: (session: Session, input: TInput) => Promise<TResult>
}

interface ActionOptionsNoInput<TResult> {
  permission?: Permission
  forbiddenMessage?: string
  action: (session: Session) => Promise<TResult>
}

// ---------------------------------------------------------------------------
// Effect mode interfaces
// ---------------------------------------------------------------------------

interface EffectOptionsBase {
  permission?: Permission
  forbiddenMessage?: string
  errors?: Record<string, string>
}

interface EffectOptionsWithInput<TInput, TData> extends EffectOptionsBase {
  effect: (session: Session, input: TInput) => Effect.Effect<TData, any>
  revalidate?: string[] | ((input: TInput) => string[])
}

interface EffectOptionsNoInput<TData> extends EffectOptionsBase {
  effect: (session: Session) => Effect.Effect<TData, any>
  revalidate?: string[]
}

// ---------------------------------------------------------------------------
// Overloads
// ---------------------------------------------------------------------------

/** Classic mode — no input */
export function withAction<TResult>(
  opts: ActionOptionsNoInput<TResult>,
): () => Promise<TResult | { error: string }>

/** Classic mode — with input */
export function withAction<TInput, TResult>(
  opts: ActionOptionsWithInput<TInput, TResult>,
): (input: TInput) => Promise<TResult | { error: string }>

/** Effect mode — no input */
export function withAction<TData>(
  opts: EffectOptionsNoInput<TData>,
): () => Promise<{ data: TData } | { error: string }>

/** Effect mode — with input */
export function withAction<TInput, TData>(
  opts: EffectOptionsWithInput<TInput, TData>,
): (input: TInput) => Promise<{ data: TData } | { error: string }>

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function withAction(opts: any): (input?: any) => Promise<any> {
  return async (input?: any) => {
    let session: Session | null
    try {
      session = await getSession()
    } catch (error) {
      captureServerError(error, { source: "withAction:session" })
      return { error: "Internal server error" }
    }
    if (!session) return { error: "Unauthorized" }

    if (opts.permission) {
      let forbidden: string | null
      try {
        forbidden = await checkPermission(session, opts.permission, opts.forbiddenMessage)
      } catch (error) {
        captureServerError(error, {
          source: "withAction:permission",
          permission: opts.permission,
          userId: session.user.id,
        })
        return { error: "Internal server error" }
      }
      if (forbidden) return { error: forbidden }
    }

    // IP allowlist gate (lower roles only)
    const role = (session.user as Record<string, unknown>).role
    if (role !== "admin" && role !== "superAdmin") {
      try {
        if (await isIpAllowlistEnabled()) {
          const h = await headers()
          const clientIp = getClientIp(h)
          const allowed = clientIp ? await isIpAllowed(clientIp) : false
          if (!allowed) {
            void recordBlock(session.user.id, clientIp ?? "unknown", "(server action)")
            return { error: "Access blocked: this device or network isn't recognized." }
          }
        }
      } catch (error) {
        captureServerError(error, {
          source: "withAction:ip-allowlist",
          userId: session.user.id,
          role,
        })
        return { error: "Internal server error" }
      }
    }

    // Effect mode
    if ("effect" in opts) {
      try {
        const eff = opts.effect(session, input)
        const data = await Effect.runPromise(eff)

        // Revalidate paths on success
        if (opts.revalidate) {
          const paths =
            typeof opts.revalidate === "function"
              ? opts.revalidate(input)
              : opts.revalidate
          for (const p of paths) {
            revalidatePath(p)
          }
        }

        return { data }
      } catch (error) {
        const tag = getErrorTag(error)
        const mappedMessage =
          tag && opts.errors && tag in opts.errors ? opts.errors[tag] : undefined

        // Expected, declared failure modes mapped via opts.errors are user-
        // facing business outcomes. Technical failures (including
        // DatabaseError) are captured even when they have a configured UI
        // message, so a friendly response cannot hide the incident.
        if (mappedMessage && isExpectedDomainError(error)) {
          return { error: mappedMessage }
        }
        captureServerError(error, {
          source: "withAction:effect",
          permission: opts.permission,
          userId: session.user.id,
          role: (session.user as Record<string, unknown>).role,
          errorTag: tag,
        })
        console.error("[withAction]", error)
        return { error: mappedMessage ?? "Internal server error" }
      }
    }

    // Classic mode — wrap so unhandled exceptions reach Sentry instead of
    // being swallowed by Next.js's server-action error boundary as a
    // generic "Server Action error".
    try {
      const result = await opts.action(session, input)
      return result
    } catch (error) {
      captureServerError(error, {
        source: "withAction:classic",
        permission: opts.permission,
        userId: session.user.id,
        role: (session.user as Record<string, unknown>).role,
      })
      // Re-throw so Next.js's normal server-action error flow still applies.
      throw error
    }
  }
}
