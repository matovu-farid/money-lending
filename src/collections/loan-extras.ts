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
import { boundedSet } from "@/lib/bounded-map"
import { subscribeToTableChanges } from "@/lib/electric"

// Auto-refresh location balances when financial tables change via Electric
subscribeToTableChanges("loans", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("payments", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("transactions", getQueryClient(), [queryKeys.locationBalances.all])
subscribeToTableChanges("fund_transfers", getQueryClient(), [queryKeys.locationBalances.all])

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
  })
)

// --- Location balances (no params, singleton) ---

export type LocationBalancesRow = {
  _key: string
  cash: string
  bank: string
  strong_room: string
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
  })
)

// --- User name resolution (parameterized by user IDs) ---

export type UserNameMapRow = { _key: string; map: Record<string, string> }

const MAX_LOAN_EXTRAS_CACHED = 50

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
    boundedSet(userNameMapCollections, key, collection, MAX_LOAN_EXTRAS_CACHED)
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
    boundedSet(loanCollateralCollections, loanId, collection, MAX_LOAN_EXTRAS_CACHED)
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
        return [{ _key: "singleton", data: result.data }]
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
    boundedSet(activeLoanCheckCollections, customerId, collection, MAX_LOAN_EXTRAS_CACHED)
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
    boundedSet(paymentPortionsCollections, key, collection, MAX_LOAN_EXTRAS_CACHED)
  }
  return collection
}