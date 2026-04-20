"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listLoansWithOverdueAction,
  createLoanAction,
} from "@/actions/loan.actions"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import type { LoanListEntry, CreateLoanInput } from "@/types/loan"
import type { SettleWithCollateralInput } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

const pendingInputs = new Map<string, CreateLoanInput>()
const pendingSettlements = new Map<string, SettleWithCollateralInput>()

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
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.loans.all })
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
        qc.invalidateQueries({ queryKey: queryKeys.loans.dueToday })
        qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
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
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      qc.invalidateQueries({ queryKey: queryKeys.loans.dueToday })
      qc.invalidateQueries({ queryKey: queryKeys.customers.all })
      qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
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
