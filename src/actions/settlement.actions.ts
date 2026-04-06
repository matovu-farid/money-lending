"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { settleWithCollateral, getCustomerActiveLoan } from "@/services/collateral-settlement.service"
import { LoanNotFound } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole, type SettleWithCollateralInput } from "@/types"

export async function settleWithCollateralAction(input: SettleWithCollateralInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
    return { error: "Only supervisors and above can settle loans with collateral" }
  }

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
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function checkCustomerActiveLoanAction(customerId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
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
