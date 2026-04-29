"use client";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useIsRestoring } from "@tanstack/react-query";

import { useState } from "react";
import dynamic from "next/dynamic";
import { getQueryClient } from "@/lib/query-client";

const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then(
      (mod) => mod.ReactQueryDevtools,
    ),
  { ssr: false },
);

// Query-key first-segments that should NOT be persisted to localStorage.
// Each entry is the `[0]` element of a key produced by `src/lib/query-keys.ts`:
//   "reports"          — pnl/balance-sheet/portfolio/retained-earnings/transactions (large)
//   "activities"       — paginated list, can grow large
//   "dashboard"        — kpis + activity, both auto-revalidated by Electric on writes
//   "loans-due-today"  — recomputed cheaply per day
//   "daily-collections"— per-date entries, grows O(dates visited)
const SKIP_PERSIST_KEYS = new Set<string>([
  "reports",
  "activities",
  "dashboard",
  "loans-due-today",
  "daily-collections",
]);

function PersistGate({ children }: { children: React.ReactNode }) {
  const isRestoring = useIsRestoring();
  return isRestoring ? null : children;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // 24h: long enough that returning to the app after lunch / overnight
        // hits warm cache. The `buster` cache-version key handles real schema
        // breaks; a short maxAge does not buy us anything we don't already get.
        maxAge: 24 * 60 * 60 * 1000,
        buster: "v5-tanstack-db",
        dehydrateOptions: {
          // Skip large/derived/per-id query keys to stay under the 5–10 MB
          // localStorage origin quota. These are all either Electric-invalidated
          // or fast aggregates, so cold-fetch on next mount is acceptable.
          shouldDehydrateQuery: (query) => {
            const head = query.queryKey[0];
            if (typeof head === "string" && SKIP_PERSIST_KEYS.has(head))
              return false;
            // Special case: ["payments", "portions", loanId, ids] entries grow
            // O(distinct loans viewed). The base ["payments"] list is small and
            // worth persisting, so we filter only the per-loan portion subkey
            // here rather than blanket-skipping the whole "payments" namespace.
            if (head === "payments" && query.queryKey[1] === "portions")
              return false;
            // Special case: persist only the small creditor aggregates — the
            // master list (`["creditors"]`), `["creditors", "capital"]`, and
            // `["creditors", "monthly-due"]`. Per-id dashboards/summaries and
            // `["creditors", "repayment-portions", ...]` grow unbounded with
            // navigation, so we skip them here.
            if (head === "creditors") {
              const second = query.queryKey[1];
              if (
                second === undefined ||
                second === "capital" ||
                second === "monthly-due"
              ) {
                return true;
              }
              return false;
            }
            return true;
          },
        },
      }}
    >
      <PersistGate>{children}</PersistGate>
      {/*
       * Sibling of <PersistGate>, NOT child: auth state is independent of
       * persistence rehydrate, so the idle prefetch can resolve auth and
       * fire its callback even while localStorage is still being read.
       */}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </PersistQueryClientProvider>
  );
}
