"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  getCollateralNaturesAction,
  getLocationBalancesAction,
  getCurrentUserRoleAction,
  resolveUserNamesAction,
  getLoanCollateralAction,
} from "@/actions/loan.actions"
import { getPaymentPortionsAction } from "@/actions/payment.actions"
import { checkCustomerActiveLoanAction } from "@/actions/settlement.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { UserRole, PaymentPortionsMap } from "@/types"
import { subscribeToTableChanges } from "@/lib/table-events"
import { boundedSet } from "@/lib/bounded-map"
import { coerceDates } from "./_utils"

// Cap on each per-id collection cache. Each entry has `startSync: true` and
// holds a live query observer; without bounding, long sessions accumulate
// dozens of background subscriptions for loans/customers no longer in view.
const MAX_PER_ID_CACHED = 32

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
  if (!collection) {
    collection = createLoanCollateralCollection(loanId)
    boundedSet(loanCollateralCollections, loanId, collection, MAX_PER_ID_CACHED, (c) => c.cleanup())
  }
  return collection
}

// --- Active loan check for customer (parameterized) ---

import type { Loan } from "@/types"

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
  if (!collection) {
    collection = createActiveLoanCheckCollection(customerId)
    boundedSet(activeLoanCheckCollections, customerId, collection, MAX_PER_ID_CACHED, (c) => c.cleanup())
  }
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
  if (!collection) {
    collection = createPaymentPortionsCollection(loanId, paymentIds)
    boundedSet(paymentPortionsCollections, key, collection, MAX_PER_ID_CACHED, (c) => c.cleanup())
  }
  return collection
}