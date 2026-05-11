import { getSession, checkPermission, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { Effect } from "effect"
import type { Permission } from "@/types"
import { headers } from "next/headers"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
import { captureServerError } from "@/lib/sentry"

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
    const session = await getSession()
    if (!session) return { error: "Unauthorized" }

    if (opts.permission) {
      const forbidden = await checkPermission(session, opts.permission, opts.forbiddenMessage)
      if (forbidden) return { error: forbidden }
    }

    // IP allowlist gate (lower roles only)
    const role = (session.user as Record<string, unknown>).role
    if (role !== "admin" && role !== "superAdmin") {
      if (await isIpAllowlistEnabled()) {
        const h = await headers()
        const clientIp = getClientIp(h)
        const allowed = clientIp ? await isIpAllowed(clientIp) : false
        if (!allowed) {
          void recordBlock(session.user.id, clientIp ?? "unknown", "(server action)")
          return { error: "Access blocked: this device or network isn't recognized." }
        }
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
        // Expected, declared failure modes mapped via opts.errors are NOT
        // reported to Sentry — they are user-facing business errors
        // (e.g. CustomerNotFound, ValidationError). Anything else is an
        // unexpected exception and gets forwarded.
        if (tag && opts.errors && tag in opts.errors) {
          return { error: opts.errors[tag] }
        }
        captureServerError(error, {
          source: "withAction:effect",
          permission: opts.permission,
          userId: session.user.id,
          role: (session.user as Record<string, unknown>).role,
          errorTag: tag,
        })
        console.error("[withAction]", error)
        return { error: "Internal server error" }
      }
    }

    // Classic mode — wrap so unhandled exceptions reach Sentry instead of
    // being swallowed by Next.js's server-action error boundary as a
    // generic "Server Action error".
    try {
      const result = await opts.action(session, input)
      // Many classic actions catch their own errors and return a generic
      // `{ error: "Internal server error" }`. That's the swallow pattern —
      // by the time we get here, the original error is gone. Forward a
      // low-fidelity warning to Sentry so the rate of these is visible
      // (we won't have a stack trace, but we'll see "this action is
      // failing more than expected" trends).
      if (
        result &&
        typeof result === "object" &&
        "error" in (result as Record<string, unknown>) &&
        (result as Record<string, unknown>).error === "Internal server error"
      ) {
        captureServerError(
          new Error("Action returned 'Internal server error' (original swallowed in inner try/catch)"),
          {
            source: "withAction:classic:swallowed",
            permission: opts.permission,
            userId: session.user.id,
            role: (session.user as Record<string, unknown>).role,
          },
        )
      }
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
