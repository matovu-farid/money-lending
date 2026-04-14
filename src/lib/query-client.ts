"use client"

import { QueryClient } from "@tanstack/react-query"

let queryClient: QueryClient | null = null

export function getQueryClient(): QueryClient {
  if (!queryClient) {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,
          gcTime: 5 * 60 * 1000,
        },
      },
    })
  }
  return queryClient
}
