import { queryCollectionOptions as _queryCollectionOptions } from "@tanstack/query-db-collection"

/**
 * Defers queryFn execution to avoid "Cannot update a component while rendering"
 * errors caused by Next.js server actions triggering Router setState during render.
 *
 * All collections MUST import queryCollectionOptions from here, not from
 * "@tanstack/query-db-collection" directly.
 */
// Re-export with identical signature — we patch the config before forwarding.
export const queryCollectionOptions = ((...args: [config: unknown]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = args[0] as any
  const originalQueryFn = config.queryFn
  if (!originalQueryFn) return (_queryCollectionOptions as Function)(config)

  return (_queryCollectionOptions as Function)({
    ...config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: async (ctx: any) => {
      // Yield to break out of React's synchronous render phase.
      await Promise.resolve()
      return originalQueryFn(ctx)
    },
  })
}) as typeof _queryCollectionOptions
