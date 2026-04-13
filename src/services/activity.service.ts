import { Effect } from "effect"
import { db } from "@/lib/db"
import { auditLog } from "@/lib/db/schema/audit"
import { user } from "@/lib/db/schema/auth"
import { customers } from "@/lib/db/schema/customers"
import { eq, desc, and, inArray, gte, lte, sql } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { ROLE_LEVELS } from "@/types/common"
import type { UserRole } from "@/types/common"
import type { ActivityItem, GetActivitiesInput, GetActivitiesResult } from "@/types/activity"
import BigNumber from "bignumber.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(amount: string | number | undefined): string {
  if (amount === undefined || amount === null) return "?"
  const num = typeof amount === "number" ? amount : parseFloat(String(amount))
  if (isNaN(num)) return "?"
  const [int, dec] = num.toFixed(0).split(".")
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return dec ? `${withCommas}.${dec}` : withCommas
}

// ─── Pure functions (exported for testing) ───────────────────────────────────

export function formatActivityDescription(
  action: string,
  entityType: string,
  beforeValue: Record<string, unknown> | null,
  afterValue: Record<string, unknown> | null,
  customerNameMap: Map<string, string>,
): string {
  const after = afterValue ?? {}
  const before = beforeValue ?? {}

  switch (action) {
    case "loan.create": {
      const amount = formatAmount(after.principalAmount as string | undefined)
      const customerId = after.customerId as string | undefined
      const customerName = customerId ? customerNameMap.get(customerId) : undefined
      return customerName
        ? `Loan issued to ${customerName} — UGX ${amount}`
        : `Loan issued — UGX ${amount}`
    }

    case "loan.rollover": {
      const customerId = before.customerId as string | undefined
      const customerName = customerId ? customerNameMap.get(customerId) : undefined
      const carriedTotal = new BigNumber(String(after.carriedPrincipal ?? "0"))
        .plus(new BigNumber(String(after.carriedInterest ?? "0")))
      const amount = formatAmount(carriedTotal.toFixed(0))
      return customerName
        ? `Loan rolled over for ${customerName} — UGX ${amount}`
        : `Loan rolled over — UGX ${amount}`
    }

    case "loan.disburse":
      return "Loan disbursed"

    case "loan.settle_with_collateral":
      return "Loan settled with collateral"

    case "loan.rate_change.approved":
      return "Loan rate change approved"

    case "loan.rate_change.rejected":
      return "Loan rate change rejected"

    case "loan.rate_change.immediate":
      return "Loan rate changed"

    case "loan.update":
      return "Loan details updated"

    case "loan.delete":
      return "Loan deleted"

    case "payment.create": {
      const amount = formatAmount(after.amount as string | undefined)
      return `Payment received — UGX ${amount}`
    }

    case "payment.delete":
      return "Payment deleted"

    case "payment.update":
      return "Payment updated"

    case "customer.create": {
      const fullName = after.fullName as string | undefined
      return fullName ? `Customer ${fullName} created` : "Customer created"
    }

    case "customer.update": {
      const fullName = after.fullName as string | undefined
      return fullName ? `Customer ${fullName} updated` : "Customer updated"
    }

    case "creditor.create": {
      const name = after.name as string | undefined
      return name ? `Creditor ${name} added` : "Creditor added"
    }

    case "fund_transfer.create": {
      const amount = formatAmount(after.amount as string | undefined)
      return `Fund transfer — UGX ${amount}`
    }

    default:
      return `${entityType} ${action}`
  }
}

export function getActivityHref(
  entityType: string,
  entityId: string,
  afterValue: Record<string, unknown> | null,
): string | null {
  switch (entityType) {
    case "loan":
      return `/loans/${entityId}`

    case "payment": {
      const loanId = afterValue?.loanId as string | undefined
      return loanId ? `/loans/${loanId}` : null
    }

    case "customer":
      return `/customers/${entityId}`

    case "creditor":
      return `/creditors/${entityId}`

    default:
      return null
  }
}

// ─── Role-based visibility ────────────────────────────────────────────────────

function getVisibleRoles(viewerRole: UserRole): UserRole[] {
  const viewerLevel = ROLE_LEVELS[viewerRole]
  return (Object.keys(ROLE_LEVELS) as UserRole[]).filter(
    (role) => ROLE_LEVELS[role] > 0 && ROLE_LEVELS[role] < viewerLevel,
  )
}

// ─── Query ────────────────────────────────────────────────────────────────────

interface GetActivitiesInputWithRole extends GetActivitiesInput {
  viewerRole: UserRole
}

export const getActivities = (
  input: GetActivitiesInputWithRole,
): Effect.Effect<GetActivitiesResult, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const { viewerRole, actorId, entityType, dateFrom, dateTo, page, pageSize } = input

      const visibleRoles = getVisibleRoles(viewerRole)
      if (visibleRoles.length === 0) {
        return { items: [], total: 0 }
      }

      // Build where conditions
      const conditions = [inArray(user.role, visibleRoles)]

      if (actorId) {
        conditions.push(eq(auditLog.actorId, actorId))
      }

      if (entityType) {
        conditions.push(eq(auditLog.entityType, entityType))
      }

      if (dateFrom) {
        conditions.push(gte(auditLog.occurredAt, new Date(dateFrom)))
      }

      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        conditions.push(lte(auditLog.occurredAt, end))
      }

      const where = and(...conditions)

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .innerJoin(user, eq(auditLog.actorId, user.id))
        .where(where)

      const total = Number(countResult?.count ?? 0)

      if (total === 0) {
        return { items: [], total: 0 }
      }

      // Fetch page
      const rows = await db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          beforeValue: auditLog.beforeValue,
          afterValue: auditLog.afterValue,
          occurredAt: auditLog.occurredAt,
          actorName: user.name,
          actorRole: user.role,
        })
        .from(auditLog)
        .innerJoin(user, eq(auditLog.actorId, user.id))
        .where(where)
        .orderBy(desc(auditLog.occurredAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      // Pre-fetch customer names for loan entries to avoid N+1
      const customerIdsToFetch = new Set<string>()
      for (const row of rows) {
        if (row.entityType === "loan" && row.action === "loan.create") {
          const afterVal = row.afterValue ? JSON.parse(row.afterValue) : {}
          if (afterVal.customerId) customerIdsToFetch.add(afterVal.customerId)
        } else if (row.entityType === "loan" && row.action === "loan.rollover") {
          const beforeVal = row.beforeValue ? JSON.parse(row.beforeValue) : {}
          if (beforeVal.customerId) customerIdsToFetch.add(beforeVal.customerId)
        }
      }

      const customerNameMap = new Map<string, string>()
      if (customerIdsToFetch.size > 0) {
        const customerRows = await db
          .select({ id: customers.id, fullName: customers.fullName })
          .from(customers)
          .where(inArray(customers.id, [...customerIdsToFetch]))
        for (const row of customerRows) {
          customerNameMap.set(row.id, row.fullName)
        }
      }

      // Map to ActivityItem[]
      const items: ActivityItem[] = rows.map((row) => {
        const afterVal = row.afterValue ? (JSON.parse(row.afterValue) as Record<string, unknown>) : null
        const beforeVal = row.beforeValue ? (JSON.parse(row.beforeValue) as Record<string, unknown>) : null

        const description = formatActivityDescription(
          row.action,
          row.entityType,
          beforeVal,
          afterVal,
          customerNameMap,
        )

        const href = getActivityHref(row.entityType, row.entityId, afterVal)

        return {
          id: row.id,
          actorName: row.actorName ?? "Unknown",
          actorRole: row.actorRole ?? "unassigned",
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          description,
          href,
          occurredAt: row.occurredAt,
        }
      })

      return { items, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
