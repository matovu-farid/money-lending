"use client"

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { useIsRestoring } from "@tanstack/react-query"
import { useState } from "react"
import dynamic from "next/dynamic"
import { getQueryClient } from "@/lib/query-client"

const ReactQueryDevtools = dynamic(
  () => import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools),
  { ssr: false },
)

function PersistGate({ children }: { children: React.ReactNode }) {
  const isRestoring = useIsRestoring()
  return isRestoring ? null : children
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient())
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    }),
  )

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 5 * 60 * 1000, buster: "v3-prefetch" }}
    >
      <PersistGate>{children}</PersistGate>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  )
}
