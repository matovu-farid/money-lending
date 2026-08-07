"use client"

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { captureClientError, isTechnicalClientError } from "@/lib/sentry"

let queryClient: QueryClient | null = null

export function getQueryClient(): QueryClient {
  if (!queryClient) {
    queryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => {
          if (isTechnicalClientError(error)) {
            captureClientError(error, { source: "react-query.query" })
          }
        },
      }),
      mutationCache: new MutationCache({
        onError: (error) => {
          if (isTechnicalClientError(error)) {
            captureClientError(error, { source: "react-query.mutation" })
          }
        },
      }),
      defaultOptions: {
        queries: {
          // Default for changeful data that's covered by Electric live invalidation.
          // Reference / non-Electric collections override staleTime per-collection.
          staleTime: 60 * 1000,
          gcTime: 30 * 60 * 1000,
          // Electric pushes live updates; window-focus refetch is duplicate work.
          // Non-Electric auth/permission collections opt back in per-collection.
          refetchOnWindowFocus: false,
        },
        mutations: {
          // Money-moving server actions must NOT auto-retry on TCP / 5xx errors.
          // Retry happens before the action's idempotency logic runs, so a
          // network blip can submit the same payment 2-3 times. Surface failures
          // to the user; let them retry deliberately.
          retry: false,
        },
      },
    })
  }
  return queryClient
}
