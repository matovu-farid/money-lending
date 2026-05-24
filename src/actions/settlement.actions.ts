"use server"

import { Effect } from "effect"
import { withAction, type Session } from "@/lib/with-action"
import { getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { settleWithCollateral, getCustomerActiveLoan } from "@/services/collateral-settlement.service"
import { type SettleWithCollateralInput } from "@/types"

export const settleWithCollateralAction = withAction({
  permission: "loan:settle",
  forbiddenMessage: "Only supervisors and above can settle loans with collateral",
  action: async (session: Session, input: SettleWithCollateralInput) => {
    if (!input.loanId?.trim()) {
      return { error: "Loan ID is required" }
    }
    if (!input.reason?.trim()) {
      return { error: "Reason is required" }
    }

    try {
      const { loan, txid } = await Effect.runPromise(settleWithCollateral(input, session.user.id))
      revalidatePath("/loans")
      revalidatePath(`/loans/${input.loanId}`)
      return { data: loan, txid }
    } catch (error) {
      if (getErrorTag(error) === "LoanNotFound") {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const checkCustomerActiveLoanAction = withAction({
  permission: "loan:read",
  action: async (_session: Session, customerId: string) => {
    if (!customerId?.trim()) {
      return { data: null }
    }

    try {
      const result = await getCustomerActiveLoan(customerId)
      return { data: result }
    } catch {
      return { error: "Internal server error" }
    }
  },
})
