"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getCollateralNaturesAction,
  getLocationBalancesAction,
  getCurrentUserRoleAction,
  resolveUserNamesAction,
  getLoanCollateralAction,
  getCustomerLoansWithOverdueAction,
} from "@/actions/loan.actions"
import { getPaymentPortionsAction, getPaymentsByLoanAction, getPaymentsForLoanIdsAction } from "@/actions/payment.actions"
import { checkCustomerActiveLoanAction } from "@/actions/settlement.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { UserRole, PaymentPortionsMap, Payment } from "@/types"
import type { Loan } from "@/types"
import type { LoanListEntry } from "@/types/loan"
import { subscribeToTableChanges } from "@/lib/table-events"
import { boundedSet, boundedTouch } from "@/lib/bounded-map"
import { coerceDates } from "./_utils"

// Cap on each per-id collection cache. Each entry has `startSync: true` and
// holds a live query observer. Raised from 32→64 and paired with LRU touch +
// pin-on-view so multi-hop loan history deep links survive (R25-3).
const MAX_PER_ID_CACHED = 64

/** Keys that must not be FIFO-evicted while their page is mounted. */
const pinnedCollectionKeys = new Set<string>()

export function pinCollectionKey(key: string): void {
  pinnedCollectionKeys.add(key)
}

export function unpinCollectionKey(key: string): void {
  pinnedCollectionKeys.delete(key)
}

// Auto-refresh location balances when any cash-moving table changes.
// Creditor investments/repayments deposit/withdraw from a location too;
// subscribing here closes the fan-out so future creditor mutations that
// skip the direct refetch in creditor-actions still keep balances fresh.
subscribeToTableChanges("loans", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("payments", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("transactions", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("fund_transfers", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("creditor_investments", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("creditor_repayments", getQueryClient(), [queryKeys.locationBalances.all])
// Per-customer loan history collections (prefix match via invalidateLendingProjections)
subscribeToTableChanges("loans", getQueryClient(), [["loans", "customer"]])
subscribeToTableChanges("payments", getQueryClient(), [["loans", "customer"]])
// Per-loan / per-customer payment collections (R17-2 / R17-3 / R23-7)
subscribeToTableChanges("payments", getQueryClient(), [
  queryKeys.payments.byLoanAll,
  queryKeys.payments.byCustomerAll,
])
subscribeToTableChanges("loans", getQueryClient(), [
  queryKeys.loans.activeLoanCheckAll,
  queryKeys.payments.byCustomerAll,
])

// --- Collateral natures (no params, singleton array) ---

export type CollateralNatureRow = { _key: string; nature: string }

export const collateralNaturesCollection = createCollection(
  queryCollectionOptions<CollateralNatureRow>({
    queryKey: [...queryKeys.collateralNatures.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<CollateralNatureRow>> => {
      const natures = await getCollateralNaturesAction()
      return natures.map((nature) => ({ _key: nature, nature }))
    },
    getKey: (row) => row._key,
    // Reference data — admin-managed and rarely changes; 1h is plenty.
    staleTime: 60 * 60 * 1000,
  })
)

// --- Location balances (no params, singleton) ---

export type LocationBalancesRow = {
  _key: string
  cash: string
  bank: string
  strong_room: string
  bankAccounts: Record<string, string>
}

export const locationBalancesCollection = createCollection(
  queryCollectionOptions<LocationBalancesRow>({
    queryKey: [...queryKeys.locationBalances.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<LocationBalancesRow>> => {
      const result = await getLocationBalancesAction()
      if ("error" in result) return []
      return [{ ...result.data, _key: "singleton" }]
    },
    getKey: (row) => row._key,
    // Prevent re-fetch storms on forms that subscribe via useLiveQuery while the
    // user is typing (each keystroke triggers a re-render of the parent form
    // component). Even though invalidations from genuine writes still mark the
    // query stale, this debounces redundant refetches within a short window.
    staleTime: 30_000,
  })
)

// --- Current user role (singleton) ---

export type UserRoleRow = { _key: string; role: UserRole }

export const currentUserRoleCollection = createCollection(
  queryCollectionOptions<UserRoleRow>({
    queryKey: [...queryKeys.auth.currentUserRole],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<UserRoleRow>> => {
      const role = await getCurrentUserRoleAction()
      return [{ _key: "singleton", role }]
    },
    getKey: (row) => row._key,
    // Auth-adjacent, no Electric backing. Short staleTime so any new
    // useLiveQuery mount within a tab refetches if the underlying role
    // could have changed. Server enforces actual permissions; this is
    // just UI freshness. (QueryCollectionConfig doesn't expose
    // refetchOnWindowFocus per-collection, so we rely on staleTime.)
    staleTime: 30_000,
  })
)

// --- User name resolution (parameterized by user IDs) ---

export type UserNameMapRow = { _key: string; map: Record<string, string> }

function createUserNameMapCollection(userIds: string[]) {
  const key = userIds.sort().join(",")
  return createCollection(
    queryCollectionOptions<UserNameMapRow>({
      queryKey: [...queryKeys.userNames.byIds(key)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<UserNameMapRow>> => {
        const map = await resolveUserNamesAction(userIds)
        return [{ _key: "singleton", map }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type UserNameMapCollectionType = ReturnType<typeof createUserNameMapCollection>
const userNameMapCollections = new Map<string, UserNameMapCollectionType>()

const emptyUserNameMapCollection = createCollection(
  queryCollectionOptions<UserNameMapRow>({
    queryKey: [...queryKeys.userNames.byIds("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<UserNameMapRow>> => [{ _key: "singleton", map: {} }],
    getKey: (row) => row._key,
  })
)

export function getUserNameMapCollection(userIds: string[]) {
  const key = userIds.sort().join(",")
  if (!key) return emptyUserNameMapCollection
  let collection = userNameMapCollections.get(key)
  if (!collection) {
    collection = createUserNameMapCollection(userIds)
    boundedSet(userNameMapCollections, key, collection, MAX_PER_ID_CACHED, (c) => c.cleanup())
  }
  return collection
}

// --- Loan collateral (parameterized by loanId) ---

export type LoanCollateralRow = { _key: string; nature: string; description: string | null }

function createLoanCollateralCollection(loanId: string) {
  return createCollection(
    queryCollectionOptions<LoanCollateralRow>({
      queryKey: [...queryKeys.loans.collateral(loanId)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<LoanCollateralRow>> => {
        const result = await getLoanCollateralAction(loanId)
        if ("error" in result || !result.data) return []
        return [{ ...result.data, _key: "singleton" }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type LoanCollateralCollectionType = ReturnType<typeof createLoanCollateralCollection>
const loanCollateralCollections = new Map<string, LoanCollateralCollectionType>()

export function getLoanCollateralCollection(loanId: string) {
  let collection = loanCollateralCollections.get(loanId)
  if (collection) {
    boundedTouch(loanCollateralCollections, loanId)
    return collection
  }
  collection = createLoanCollateralCollection(loanId)
  boundedSet(
    loanCollateralCollections,
    loanId,
    collection,
    MAX_PER_ID_CACHED,
    (c) => c.cleanup(),
    pinnedCollectionKeys,
  )
  return collection
}

// --- Active loan check for customer (parameterized) ---

export type ActiveLoanCheckData = {
  loan: Loan
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
} | null

export type ActiveLoanCheckRow = { _key: string; data: ActiveLoanCheckData }

function createActiveLoanCheckCollection(customerId: string) {
  return createCollection(
    queryCollectionOptions<ActiveLoanCheckRow>({
      queryKey: [...queryKeys.loans.activeLoanCheck(customerId)],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<ActiveLoanCheckRow>> => {
        const result = await checkCustomerActiveLoanAction(customerId)
        if ("error" in result || !result.data) return []
        const [loan] = coerceDates(
          [result.data.loan],
          ["startDate", "penaltyWaivedAt", "backdatedFrom", "backdatedAt", "createdAt", "updatedAt", "deletedAt"],
        )
        return [{ _key: "singleton", data: { ...result.data, loan } }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type ActiveLoanCheckCollectionType = ReturnType<typeof createActiveLoanCheckCollection>
const activeLoanCheckCollections = new Map<string, ActiveLoanCheckCollectionType>()

const emptyActiveLoanCheckCollection = createCollection(
  queryCollectionOptions<ActiveLoanCheckRow>({
    queryKey: [...queryKeys.loans.activeLoanCheck("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<ActiveLoanCheckRow>> => [{ _key: "singleton", data: null }],
    getKey: (row) => row._key,
  })
)

export function getActiveLoanCheckCollection(customerId: string) {
  if (!customerId) return emptyActiveLoanCheckCollection
  let collection = activeLoanCheckCollections.get(customerId)
  if (collection) {
    boundedTouch(activeLoanCheckCollections, customerId)
    return collection
  }
  collection = createActiveLoanCheckCollection(customerId)
  boundedSet(
    activeLoanCheckCollections,
    customerId,
    collection,
    MAX_PER_ID_CACHED,
    (c) => c.cleanup(),
    pinnedCollectionKeys,
  )
  return collection
}

// --- Payment portions (parameterized by loanId + paymentIds) ---

export type PaymentPortionsRow = { _key: string; portions: PaymentPortionsMap }

function createPaymentPortionsCollection(loanId: string, paymentIds: string[]) {
  return createCollection(
    queryCollectionOptions<PaymentPortionsRow>({
      queryKey: [...queryKeys.payments.portions(loanId, paymentIds.join(","))],
      queryClient: getQueryClient(),
      queryFn: async (_ctx): Promise<Array<PaymentPortionsRow>> => {
        const result = await getPaymentPortionsAction(paymentIds)
        if ("error" in result) return [{ _key: "singleton", portions: {} }]
        return [{ _key: "singleton", portions: result.data }]
      },
      getKey: (row) => row._key,
      startSync: true,
    })
  )
}

type PaymentPortionsCollectionType = ReturnType<typeof createPaymentPortionsCollection>
const paymentPortionsCollections = new Map<string, PaymentPortionsCollectionType>()

const emptyPaymentPortionsCollection = createCollection(
  queryCollectionOptions<PaymentPortionsRow>({
    queryKey: [...queryKeys.payments.portions("__empty__", "")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<PaymentPortionsRow>> => [{ _key: "singleton", portions: {} }],
    getKey: (row) => row._key,
  })
)

export function getPaymentPortionsCollection(loanId: string, paymentIds: string[]) {
  if (paymentIds.length === 0) return emptyPaymentPortionsCollection
  const key = `${loanId}:${paymentIds.sort().join(",")}`
  let collection = paymentPortionsCollections.get(key)
  if (collection) {
    boundedTouch(paymentPortionsCollections, key)
    return collection
  }
  collection = createPaymentPortionsCollection(loanId, paymentIds)
  boundedSet(
    paymentPortionsCollections,
    key,
    collection,
    MAX_PER_ID_CACHED,
    (c) => c.cleanup(),
    pinnedCollectionKeys,
  )
  return collection
}

// --- Customer loans with overdue (uncapped per customer — R13-2 / Phase 2.4) ---

export type CustomerLoanRow = LoanListEntry & { _key: string }

function createCustomerLoansCollection(customerId: string) {
  return createCollection(
    queryCollectionOptions<CustomerLoanRow>({
      queryKey: [...queryKeys.loans.customerLoans(customerId)],
      queryClient: getQueryClient(),
      queryFn: async (): Promise<Array<CustomerLoanRow>> => {
        const result = await getCustomerLoansWithOverdueAction(customerId)
        if ("error" in result) return []
        return coerceDates(
          result.data.map((loan) => ({ ...loan, _key: loan.id })),
          [
            "startDate",
            "penaltyWaivedAt",
            "backdatedFrom",
            "backdatedAt",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "lastPaymentDate",
          ],
        ) as CustomerLoanRow[]
      },
      getKey: (row) => row._key,
      startSync: true,
      staleTime: 30_000,
    }),
  )
}

type CustomerLoansCollectionType = ReturnType<typeof createCustomerLoansCollection>
const customerLoansCollections = new Map<string, CustomerLoansCollectionType>()

const emptyCustomerLoansCollection = createCollection(
  queryCollectionOptions<CustomerLoanRow>({
    queryKey: [...queryKeys.loans.customerLoans("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<CustomerLoanRow>> => [],
    getKey: (row) => row._key,
  }),
)

/**
 * Uncapped loan history for one customer (credit score + customer detail).
 * Do not use the global 500-cap loanCollection for this surface.
 */
export function getCustomerLoansCollection(customerId: string) {
  if (!customerId) return emptyCustomerLoansCollection
  let collection = customerLoansCollections.get(customerId)
  if (collection) {
    boundedTouch(customerLoansCollections, customerId)
    return collection
  }
  collection = createCustomerLoansCollection(customerId)
  boundedSet(
    customerLoansCollections,
    customerId,
    collection,
    MAX_PER_ID_CACHED,
    (c) => c.cleanup(),
    pinnedCollectionKeys,
  )
  return collection
}

// --- Per-loan payments (uncapped — R17-3) ---

export type LoanPaymentRow = Payment & { _key: string }

function createLoanPaymentsCollection(loanId: string) {
  return createCollection(
    queryCollectionOptions<LoanPaymentRow>({
      queryKey: [...queryKeys.payments.byLoan(loanId)],
      queryClient: getQueryClient(),
      queryFn: async (): Promise<Array<LoanPaymentRow>> => {
        const result = await getPaymentsByLoanAction(loanId)
        if ("error" in result) return []
        return coerceDates(
          result.data.map((p) => ({ ...p, _key: p.id })),
          ["paymentDate", "createdAt", "updatedAt", "deletedAt"],
        ) as LoanPaymentRow[]
      },
      getKey: (row) => row._key,
      startSync: true,
      staleTime: 30_000,
    }),
  )
}

type LoanPaymentsCollectionType = ReturnType<typeof createLoanPaymentsCollection>
const loanPaymentsCollections = new Map<string, LoanPaymentsCollectionType>()

const emptyLoanPaymentsCollection = createCollection(
  queryCollectionOptions<LoanPaymentRow>({
    queryKey: [...queryKeys.payments.byLoan("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<LoanPaymentRow>> => [],
    getKey: (row) => row._key,
  }),
)

/** Uncapped payments for one loan — loan detail / history (not global 2000-cap). */
export function getLoanPaymentsCollection(loanId: string) {
  if (!loanId) return emptyLoanPaymentsCollection
  let collection = loanPaymentsCollections.get(loanId)
  if (collection) {
    boundedTouch(loanPaymentsCollections, loanId)
    return collection
  }
  collection = createLoanPaymentsCollection(loanId)
  boundedSet(
    loanPaymentsCollections,
    loanId,
    collection,
    MAX_PER_ID_CACHED,
    (c) => c.cleanup(),
    pinnedCollectionKeys,
  )
  return collection
}

// --- Per-customer payments across all their loans (uncapped — R17-2) ---

export type CustomerPaymentRow = Payment & { _key: string }

function createCustomerPaymentsCollection(customerId: string, loanIds: string[]) {
  const key = [...loanIds].sort().join(",")
  return createCollection(
    queryCollectionOptions<CustomerPaymentRow>({
      queryKey: [...queryKeys.payments.byCustomer(customerId), key],
      queryClient: getQueryClient(),
      queryFn: async (): Promise<Array<CustomerPaymentRow>> => {
        const result = await getPaymentsForLoanIdsAction(loanIds)
        if ("error" in result) return []
        return coerceDates(
          result.data.map((p) => ({ ...p, _key: p.id })),
          ["paymentDate", "createdAt", "updatedAt", "deletedAt"],
        ) as CustomerPaymentRow[]
      },
      getKey: (row) => row._key,
      startSync: true,
      staleTime: 30_000,
    }),
  )
}

type CustomerPaymentsCollectionType = ReturnType<
  typeof createCustomerPaymentsCollection
>
const customerPaymentsCollections = new Map<string, CustomerPaymentsCollectionType>()

const emptyCustomerPaymentsCollection = createCollection(
  queryCollectionOptions<CustomerPaymentRow>({
    queryKey: [...queryKeys.payments.byCustomer("__empty__")],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<CustomerPaymentRow>> => [],
    getKey: (row) => row._key,
  }),
)

/**
 * Uncapped payments for a customer's loan set (credit score).
 * Keyed by customerId + sorted loanIds so the collection refreshes when
 * the loan set changes after rollover.
 */
export function getCustomerPaymentsCollection(
  customerId: string,
  loanIds: string[],
) {
  if (!customerId || loanIds.length === 0) return emptyCustomerPaymentsCollection
  const cacheKey = `${customerId}:${[...loanIds].sort().join(",")}`
  let collection = customerPaymentsCollections.get(cacheKey)
  if (collection) {
    boundedTouch(customerPaymentsCollections, cacheKey)
    return collection
  }
  collection = createCustomerPaymentsCollection(customerId, loanIds)
  boundedSet(
    customerPaymentsCollections,
    cacheKey,
    collection,
    MAX_PER_ID_CACHED,
    (c) => c.cleanup(),
    pinnedCollectionKeys,
  )
  return collection
}
