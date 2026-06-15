"use server"

import { withAction } from "@/lib/with-action"
import { checkPermission } from "@/lib/action-utils"
import type { TransactionReceiptData } from "@/components/receipts/pos-receipt-transaction"
import { buildReceipt, type ReceiptInput } from "@/services/receipt.service"
import type { Permission } from "@/types"

export type { ReceiptInput }

/**
 * Per-kind permission gate. Mirrors the entity-level access policy:
 * creditor data is admin-only (`creditor:read`), fund transfers require
 * supervisor (`fund-transfer:read`), and the rest follow their record's
 * read permission.
 */
const KIND_PERMISSIONS = {
  expense: "expense:read",
  income: "income:read",
  creditor_investment: "creditor:read",
  creditor_repayment: "creditor:read",
  fund_transfer: "fund-transfer:read",
  collateral_settlement: "loan:read",
} as const satisfies Record<ReceiptInput["kind"], string>

/**
 * Returns normalized receipt data for any money-movement event.
 *
 * Permission is checked per-kind: creditor receipts require `creditor:read`
 * (admin-only), expense/income/fund-transfer/settlement gate against their
 * own record-read perms. withAction binds a single permission up front, so
 * we use `loan:read` as the baseline "any-staff" gate and re-check the
 * kind-specific perm inside. Without this, a loan officer who only has
 * `loan:read` could pull creditor names/contacts via a direct action call,
 * bypassing the page-level and Electric-proxy gates.
 */
export const getTransactionReceiptDataAction = withAction<
  ReceiptInput,
  { data: TransactionReceiptData } | { error: string }
>({
  permission: "loan:read",
  action: async (session, input) => {
    const required = KIND_PERMISSIONS[input.kind] as Permission
    const forbidden = await checkPermission(session, required)
    if (forbidden) return { error: forbidden }

    const result = await buildReceipt(input)
    if ("error" in result) return { error: result.error }
    return { data: result }
  },
})
