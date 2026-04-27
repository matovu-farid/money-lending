"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listLoansWithOverdueAction,
  createLoanAction,
  waivePenaltyAction,
  adjustPenaltyMultiplierAction,
} from "@/actions/loan.actions"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import type { LoanListEntry, CreateLoanInput } from "@/types/loan"
import type { SettleWithCollateralInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh when loans table changes via Electric
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.loans.all,
  queryKeys.loans.dueToday,
])

const pendingInputs = new Map<string, CreateLoanInput>()
const pendingSettlements = new Map<string, SettleWithCollateralInput>()

type PenaltyOp =
  | { kind: "waive" }
  | { kind: "adjust"; multiplier: string }
const pendingPenaltyOps = new Map<string, PenaltyOp>()

export const loanCollection = createCollection(
  queryCollectionOptions<LoanListEntry>({
    queryKey: [...queryKeys.loans.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LoanListEntry>> => {
      const result = await listLoansWithOverdueAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (loan) => loan.id,
    onUpdate: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const settleInput = pendingSettlements.get(original.id)
      if (settleInput) {
        const result = await settleWithCollateralAction(settleInput)
        pendingSettlements.delete(original.id)
        if ("error" in result) throw new Error(result.error)
        // Invalidate only query-based collections (Electric handles loans auto-refresh)
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
        return
      }

      const penaltyOp = pendingPenaltyOps.get(original.id)
      if (penaltyOp) {
        pendingPenaltyOps.delete(original.id)
        if (penaltyOp.kind === "waive") {
          const result = await waivePenaltyAction(original.id)
          if ("error" in result) throw new Error(result.error)
        } else {
          const result = await adjustPenaltyMultiplierAction(
            original.id,
            penaltyOp.multiplier
          )
          if ("error" in result) throw new Error(result.error)
        }
        // Loans collection is query-backed; Electric auto-refreshes via
        // subscribeToTableChanges. Also invalidate balance which reads
        // penalty fields downstream.
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loans.all })
        qc.invalidateQueries({ queryKey: queryKeys.loans.balance(original.id) })
      }
    },
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input = pendingInputs.get(modified.id)
      if (!input) {
        throw new Error("Missing loan input for optimistic insert")
      }
      const result = await createLoanAction(input)
      pendingInputs.delete(modified.id)
      if ("error" in result) {
        throw new Error(result.error)
      }
      // Invalidate only query-based collections (Electric handles auto-refresh for table-backed ones)
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
    },
  })
)

export function settleLoanWithCollateral(
  loanId: string,
  reason: string
) {
  pendingSettlements.set(loanId, { loanId, reason })
  loanCollection.update(loanId, (draft) => {
    draft.status = "fully_paid"
  })
}

export function insertLoanWithInput(
  id: string,
  optimistic: LoanListEntry,
  input: CreateLoanInput
) {
  pendingInputs.set(id, input)
  loanCollection.insert(optimistic)
}

/**
 * Optimistically waive the penalty on a loan. Marks the local row as
 * `penaltyWaived: true` immediately and dispatches `waivePenaltyAction`
 * via the collection's onUpdate handler. Throws if the row is not in
 * the local collection.
 */
export function waiveLoanPenaltyWithInput(loanId: string) {
  pendingPenaltyOps.set(loanId, { kind: "waive" })
  loanCollection.update(loanId, (draft) => {
    draft.penaltyWaived = true
    draft.penaltyWaivedAt = new Date()
  })
}

/**
 * Optimistically adjust the penalty multiplier on a loan. Updates the
 * local row's `penaltyMultiplier` immediately and dispatches
 * `adjustPenaltyMultiplierAction` via the collection's onUpdate handler.
 *
 * @param loanId  the loan id to update
 * @param multiplier decimal string e.g. "0.1000" for 10%
 */
export function adjustLoanPenaltyMultiplierWithInput(
  loanId: string,
  multiplier: string
) {
  pendingPenaltyOps.set(loanId, { kind: "adjust", multiplier })
  loanCollection.update(loanId, (draft) => {
    draft.penaltyMultiplier = multiplier
  })
}
