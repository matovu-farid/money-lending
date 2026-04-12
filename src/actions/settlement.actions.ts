"use server"

import { Effect } from "effect"
import { getSession, requireRole, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { settleWithCollateral, getCustomerActiveLoan } from "@/services/collateral-settlement.service"
import { type SettleWithCollateralInput } from "@/types"

export async function settleWithCollateralAction(input: SettleWithCollateralInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const forbidden = requireRole(session, "supervisor", "Only supervisors and above can settle loans with collateral")
  if (forbidden) return { error: forbidden }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "Reason is required" }
  }

  try {
    const data = await Effect.runPromise(settleWithCollateral(input, session.user.id))
    revalidatePath("/loans")
    revalidatePath(`/loans/${input.loanId}`)
    return { data }
  } catch (error) {
    if (getErrorTag(error) === "LoanNotFound") {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function checkCustomerActiveLoanAction(customerId: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!customerId?.trim()) {
    return { data: null }
  }

  try {
    const result = await getCustomerActiveLoan(customerId)
    return { data: result }
  } catch {
    return { error: "Internal server error" }
  }
}
