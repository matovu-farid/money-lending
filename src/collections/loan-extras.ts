"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
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
import type { UserRole, PaymentPortionsMap } from "@/types"

// --- Collateral natures (no params, singleton array) ---

export type CollateralNatureRow = { _key: string; nature: string }

export const collateralNaturesCollection = createCollection(
  queryCollectionOptions<CollateralNatureRow>({
    queryKey: ["collateral-natures"],
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
    queryKey: ["location-balances"],
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
    queryKey: ["current-user-role"],
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

const userNameMapCollections = new Map<string, any>()

export function getUserNameMapCollection(userIds: string[]) {
  const key = userIds.sort().join(",")
  if (!key) return null
  let collection = userNameMapCollections.get(key)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<UserNameMapRow>({
        queryKey: ["user-names", key],
        queryClient: getQueryClient(),
        queryFn: async (_ctx): Promise<Array<UserNameMapRow>> => {
          const map = await resolveUserNamesAction(userIds)
          return [{ _key: "singleton", map }]
        },
        getKey: (row) => row._key,
      })
    )
    userNameMapCollections.set(key, collection)
  }
  return collection
}

// --- Loan collateral (parameterized by loanId) ---

export type LoanCollateralRow = { _key: string; nature: string; description: string | null }

const loanCollateralCollections = new Map<string, any>()

export function getLoanCollateralCollection(loanId: string) {
  let collection = loanCollateralCollections.get(loanId)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<LoanCollateralRow>({
        queryKey: ["loans", loanId, "collateral"],
        queryClient: getQueryClient(),
        queryFn: async (_ctx): Promise<Array<LoanCollateralRow>> => {
          const result = await getLoanCollateralAction(loanId)
          if ("error" in result || !result.data) return []
          return [{ ...result.data, _key: "singleton" }]
        },
        getKey: (row) => row._key,
      })
    )
    loanCollateralCollections.set(loanId, collection)
  }
  return collection
}

// --- Active loan check for customer (parameterized) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActiveLoanCheckRow = { _key: string; data: any }

const activeLoanCheckCollections = new Map<string, any>()

export function getActiveLoanCheckCollection(customerId: string) {
  if (!customerId) return null
  let collection = activeLoanCheckCollections.get(customerId)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<ActiveLoanCheckRow>({
        queryKey: ["active-loan-check", customerId],
        queryClient: getQueryClient(),
        queryFn: async (_ctx): Promise<Array<ActiveLoanCheckRow>> => {
          const result = await checkCustomerActiveLoanAction(customerId)
          if ("error" in result || !result.data) return []
          return [{ _key: "singleton", data: result.data }]
        },
        getKey: (row) => row._key,
      })
    )
    activeLoanCheckCollections.set(customerId, collection)
  }
  return collection
}

// --- Payment portions (parameterized by loanId + paymentIds) ---

export type PaymentPortionsRow = { _key: string; portions: PaymentPortionsMap }

const paymentPortionsCollections = new Map<string, any>()

export function getPaymentPortionsCollection(loanId: string, paymentIds: string[]) {
  if (paymentIds.length === 0) return null
  const key = `${loanId}:${paymentIds.sort().join(",")}`
  let collection = paymentPortionsCollections.get(key)
  if (!collection) {
    collection = createCollection(
      queryCollectionOptions<PaymentPortionsRow>({
        queryKey: ["payments", "portions", loanId, paymentIds.join(",")],
        queryClient: getQueryClient(),
        queryFn: async (_ctx): Promise<Array<PaymentPortionsRow>> => {
          const result = await getPaymentPortionsAction(paymentIds)
          if ("error" in result) return [{ _key: "singleton", portions: {} }]
          return [{ _key: "singleton", portions: result.data }]
        },
        getKey: (row) => row._key,
      })
    )
    paymentPortionsCollections.set(key, collection)
  }
  return collection
}

// --- Expense categories (no params) ---

export type ExpenseCategoryRow = { _key: string; id: string; name: string }
