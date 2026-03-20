"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { createLoan, listLoans } from "@/services/loan.service"
import {
  CustomerNotFound,
  IncompleteLoanRequirements,
} from "@/lib/errors"
import { ROLE_LEVELS, type UserRole, type CreateLoanInput } from "@/types"
import { sendAdminNotification } from "@/lib/email"

export async function listLoansAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listLoans())
    return { data }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

export async function createLoanAction(input: CreateLoanInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // Runtime validation -- TypeScript types are erased at runtime
  if (!input.customerId?.trim()) {
    return { error: "Customer ID is required" }
  }
  if (!input.principalAmount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.principalAmount)) {
    return { error: "Principal must be a valid decimal number" }
  }
  if (!input.startDate?.trim()) {
    return { error: "Start date is required" }
  }
  if (!input.collateral?.nature?.trim()) {
    return { error: "Collateral nature is required" }
  }

  // Apply defaults
  const loanInput: CreateLoanInput = {
    ...input,
    interestRate: input.interestRate || "0.10",
    minInterestDays: input.minInterestDays || 30,
  }

  // LOAN-11 + AUTH-03: Only admin+ can submit override fields
  const role = (session.user.role ?? "unassigned") as UserRole

  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    // Strip override fields from non-admin users
    loanInput.interestRateOverride = null
    loanInput.minPeriodOverride = null
  }

  try {
    const data = await Effect.runPromise(
      createLoan(loanInput, session.user.id)
    )
    void sendAdminNotification("loan.disbursed", {
      actorName: session.user.name ?? "Unknown",
      actorEmail: session.user.email,
      loanRef: `LOAN-${data.id.slice(0, 8).toUpperCase()}`,
      amount: input.principalAmount,
      timestamp: new Date(),
    })
    return { data }
  } catch (error) {
    if (error instanceof CustomerNotFound) {
      return { error: "Customer not found" }
    }
    if (error instanceof IncompleteLoanRequirements) {
      return {
        error: "Incomplete loan requirements",
        details: { missing: (error as any).missing },
      }
    }
    return { error: "Internal server error" }
  }
}
