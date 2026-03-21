"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import {
  createCreditor,
  updateCreditor,
  addInvestment,
  recordCreditorRepayment,
} from "@/services/creditor.service"
import type {
  CreateCreditorInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
} from "@/types"

async function getSessionOrThrow() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    throw new Error("Unauthorized")
  }
  return session
}

/**
 * Creates a new creditor.
 * CRED-01: Creditor registration with name, contact, address.
 */
export async function createCreditorAction(input: CreateCreditorInput) {
  const session = await getSessionOrThrow()
  const creditor = await Effect.runPromise(
    createCreditor(input, session.user.id)
  )
  revalidatePath("/creditors")
  return creditor
}

/**
 * Updates an existing creditor's details.
 * CRED-01: Creditor profile with edit capability.
 */
export async function updateCreditorAction(
  id: string,
  input: UpdateCreditorInput
) {
  const session = await getSessionOrThrow()
  const creditor = await Effect.runPromise(
    updateCreditor(id, input, session.user.id)
  )
  revalidatePath("/creditors")
  revalidatePath(`/creditors/${id}`)
  return creditor
}

/**
 * Adds a new investment for a creditor.
 * CRED-02: Multiple investments per creditor with individual rates.
 */
export async function addInvestmentAction(input: AddInvestmentInput) {
  const session = await getSessionOrThrow()
  const investment = await Effect.runPromise(
    addInvestment(input, session.user.id)
  )
  revalidatePath("/creditors")
  revalidatePath(`/creditors/${input.creditorId}`)
  return investment
}

/**
 * Records a repayment against a creditor investment.
 * CRED-04: Interest-first allocation using the same engine as borrower loans.
 */
export async function recordCreditorRepaymentAction(
  input: RecordCreditorRepaymentInput
) {
  const session = await getSessionOrThrow()
  const repayment = await Effect.runPromise(
    recordCreditorRepayment(input, session.user.id)
  )
  revalidatePath("/creditors")
  return repayment
}
