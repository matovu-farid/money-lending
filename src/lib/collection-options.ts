import { queryCollectionOptions as _queryCollectionOptions } from "@tanstack/query-db-collection"

/**
 * Defers queryFn execution to avoid "Cannot update a component while rendering"
 * errors caused by Next.js server actions triggering Router setState during render.
 *
 * All collections MUST import queryCollectionOptions from here, not from
 * "@tanstack/query-db-collection" directly.
 *
 * The wrapper is generic over the upstream `queryCollectionOptions` signature
 * (preserving every overload's inference) — we only intercept the `queryFn`
 * field to wrap it in a `Promise.resolve()` tick. All other fields pass
 * through unchanged.
 */

// Upstream is heavily overloaded. We re-export it with the SAME callable type
// so downstream callers get full inference (return type, queryFn arg shape).
// The Parameters/ReturnType + spread pattern preserves overload resolution
// because we never touch the type — we just intercept the runtime config.
type QueryCollectionOptionsFn = typeof _queryCollectionOptions

// The wrapped `queryFn` deferral is purely behavioural; it must NOT change
// the queryFn's input or output types, so we only mutate the function body.
type ConfigWithMaybeQueryFn = {
  queryFn?: (ctx: unknown) => unknown | Promise<unknown>
}

export const queryCollectionOptions: QueryCollectionOptionsFn = ((
  config: ConfigWithMaybeQueryFn,
) => {
  const originalQueryFn = config.queryFn
  if (!originalQueryFn) {
    // No queryFn provided — forward as-is. Upstream's runtime accepts the
    // same shape; the cast through `unknown` is the single boundary cast
    // we cannot avoid because the upstream signature isn't a single concrete
    // call we can reuse.
    return (_queryCollectionOptions as unknown as (c: unknown) => unknown)(config)
  }

  return (_queryCollectionOptions as unknown as (c: unknown) => unknown)({
    ...config,
    queryFn: async (ctx: unknown) => {
      // Yield to break out of React's synchronous render phase.
      await Promise.resolve()
      return originalQueryFn(ctx)
    },
  })
}) as QueryCollectionOptionsFn
