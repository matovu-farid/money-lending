import "server-only"
import { getSession, checkPermission, getErrorTag, type Session, type SessionUser } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { Effect } from "effect"
import type { Permission } from "@/types"
import { headers } from "next/headers"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
import { captureServerError } from "@/lib/sentry"
import { isErrorResult } from "@/lib/action-result"

// Re-export the canonical Session types defined alongside getSession() so
// existing imports `from "@/lib/with-action"` keep working.
export type { Session, SessionUser }

// Re-exported from the client-safe module so existing server-side imports
// `from "@/lib/with-action"` keep working. Client components must import the
// guard directly from `@/lib/action-result` — pulling it through this file
// drags the whole server graph (DB, next/headers) into the browser bundle.
export { isErrorResult }

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
  // Error channel is `unknown` so any service-level tagged-error union from
  // `Effect.fail(new XError())` is acceptable. The implementation reaches into
  // thrown errors via `getErrorTag` which already accepts `unknown`.
  effect: (session: Session, input: TInput) => Effect.Effect<TData, unknown>
  revalidate?: string[] | ((input: TInput) => string[])
}

interface EffectOptionsNoInput<TData> extends EffectOptionsBase {
  effect: (session: Session) => Effect.Effect<TData, unknown>
  revalidate?: string[]
}

// Permissive structural shape that covers all four overloads below without
// resorting to `any`. The public API is exposed via the typed overloads — this
// describes the runtime branching needs only (`action` vs `effect`, optional
// `revalidate`, optional `errors`, etc.).
type AnyWithActionOptions = EffectOptionsBase & {
  action?: (session: Session, input?: unknown) => Promise<unknown>
  effect?: (session: Session, input?: unknown) => Effect.Effect<unknown, unknown>
  revalidate?: string[] | ((input: unknown) => string[])
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

export function withAction(
  opts: AnyWithActionOptions,
): (input?: unknown) => Promise<unknown> {
  return async (input?: unknown) => {
    const session = await getSession()
    if (!session) return { error: "Unauthorized" }

    if (opts.permission) {
      const forbidden = await checkPermission(session, opts.permission, opts.forbiddenMessage)
      if (forbidden) return { error: forbidden }
    }

    // IP allowlist gate (lower roles only)
    const role = session.user.role
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
    if (opts.effect) {
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
          role: session.user.role,
          errorTag: tag,
        })
        console.error("[withAction]", error)
        return { error: "Internal server error" }
      }
    }

    // Classic mode — wrap so unhandled exceptions reach Sentry instead of
    // being swallowed by Next.js's server-action error boundary as a
    // generic "Server Action error".
    if (!opts.action) {
      throw new Error("withAction: options must include either `action` or `effect`")
    }
    try {
      const result = await opts.action(session, input)
      // Many classic actions catch their own errors and return a generic
      // `{ error: "Internal server error" }`. That's the swallow pattern —
      // by the time we get here, the original error is gone. Forward a
      // low-fidelity warning to Sentry so the rate of these is visible
      // (we won't have a stack trace, but we'll see "this action is
      // failing more than expected" trends).
      if (isErrorResult(result) && result.error === "Internal server error") {
        captureServerError(
          new Error("Action returned 'Internal server error' (original swallowed in inner try/catch)"),
          {
            source: "withAction:classic:swallowed",
            permission: opts.permission,
            userId: session.user.id,
            role: session.user.role,
          },
        )
      }
      return result
    } catch (error) {
      captureServerError(error, {
        source: "withAction:classic",
        permission: opts.permission,
        userId: session.user.id,
        role: session.user.role,
      })
      // Re-throw so Next.js's normal server-action error flow still applies.
      throw error
    }
  }
}
