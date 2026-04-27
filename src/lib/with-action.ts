import { getSession, checkPermission, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { Effect } from "effect"
import type { Permission } from "@/types"

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
        if (tag && opts.errors && tag in opts.errors) {
          return { error: opts.errors[tag] }
        }
        console.error("[withAction]", error)
        return { error: "Internal server error" }
      }
    }

    // Classic mode
    return opts.action(session, input)
  }
}
