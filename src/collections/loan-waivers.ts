"use client";

import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@/lib/collection-options";
import {
  waiveLoanAmountAction,
  listLoanWaiversAction,
} from "@/actions/loan-waiver.actions";
import { loanWaiverSchema, type LoanWaiverRow } from "@/lib/schemas/collections";
import { getQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { invalidateLendingProjections } from "@/lib/cache-invalidation";
import { emitTableChange } from "@/lib/table-events";
import { throwIfActionError, coerceDates } from "./_utils";
import type { WaiveLoanAmountInput } from "@/types";

export type { LoanWaiverRow };

type WaiverInsertMetadata = {
  input: WaiveLoanAmountInput;
};

function invalidateCrossCutting(loanId: string) {
  const qc = getQueryClient();
  invalidateLendingProjections(qc);
  qc.invalidateQueries({ queryKey: queryKeys.loanWaivers.all });
  qc.invalidateQueries({ queryKey: queryKeys.loanWaivers.byLoan(loanId) });
  emitTableChange("loan_waivers");
  emitTableChange("transactions");
  emitTableChange("loans");
}

function createLoanWaiversCollection(loanId: string) {
  return createCollection(
    queryCollectionOptions({
      id: `loan-waivers-${loanId}`,
      schema: loanWaiverSchema,
      getKey: (row) => row.id,
      queryKey: [...queryKeys.loanWaivers.byLoan(loanId)],
      queryClient: getQueryClient(),
      queryFn: async () => {
        const rows = throwIfActionError(await listLoanWaiversAction(loanId))
          .data;
        return coerceDates(rows, ["waiverDate", "createdAt", "deletedAt"]);
      },
      staleTime: 30_000,
      onInsert: async ({ transaction }) => {
        const { modified, metadata } = transaction.mutations[0];
        const meta = metadata as WaiverInsertMetadata | undefined;
        if (!meta?.input) {
          throw new Error("Waiver inserts must include metadata.input");
        }
        const input: WaiveLoanAmountInput = {
          ...meta.input,
          id: meta.input.id ?? modified.id,
        };
        const result = throwIfActionError(await waiveLoanAmountAction(input));
        invalidateCrossCutting(input.loanId);
        return { txid: result.txid };
      },
    }),
  );
}

type LoanWaiversCollectionType = ReturnType<typeof createLoanWaiversCollection>;
const loanWaiversCollections = new Map<string, LoanWaiversCollectionType>();

const emptyLoanWaiversCollection = createCollection(
  queryCollectionOptions({
    id: "loan-waivers-empty",
    schema: loanWaiverSchema,
    getKey: (row) => row.id,
    queryKey: [...queryKeys.loanWaivers.byLoan("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async () => [],
    staleTime: 30_000,
  }),
);

/** Uncapped waivers for one loan — admin-only loan detail history. */
export function getLoanWaiversCollection(loanId: string) {
  if (!loanId) return emptyLoanWaiversCollection;
  let collection = loanWaiversCollections.get(loanId);
  if (!collection) {
    collection = createLoanWaiversCollection(loanId);
    loanWaiversCollections.set(loanId, collection);
  }
  return collection;
}

export function insertWaiverWithInput(
  optimistic: LoanWaiverRow,
  input: WaiveLoanAmountInput,
) {
  return getLoanWaiversCollection(input.loanId).insert(optimistic, {
    metadata: { input } satisfies WaiverInsertMetadata,
  });
}
