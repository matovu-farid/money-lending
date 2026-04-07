"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createLoanAction } from "@/actions/loan.actions"
import { queryKeys } from "./query-keys"
import type { CreateLoanInput, LoanWithCustomer } from "@/types"

export function useCreateLoan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateLoanInput) => createLoanAction(input),
    onMutate: async (input) => {
      // Cancel outgoing loan list refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.loans.all })

      // Snapshot for rollback
      const previousLoans = queryClient.getQueryData<LoanWithCustomer[]>(
        queryKeys.loans.all,
      )

      // Create optimistic loan entry
      const optimistic: LoanWithCustomer = {
        id: `optimistic-${crypto.randomUUID()}`,
        customerId: input.customerId,
        customerName: "Loading...",
        customerContact: null,
        principalAmount: input.principalAmount,
        issuanceFee: input.issuanceFee,
        description: input.description,
        interestRate: input.interestRate || "0.10",
        minInterestDays: input.minInterestDays || 30,
        interestRateOverride: input.interestRateOverride ?? null,
        minPeriodOverride: input.minPeriodOverride ?? null,
        startDate: new Date(input.startDate),
        status: "active",
        issuedBy: "",
        disbursementSource: input.disbursementSource,
        loanType: input.loanType ?? "perpetual",
        termMonths: input.termMonths ?? null,
        rolledOverFrom: input.rollover?.fromLoanId ?? null,
        rolloverAmount: input.rollover
          ? (parseFloat(input.rollover.carriedPrincipal) + parseFloat(input.rollover.carriedInterest)).toFixed(2)
          : null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Add to the loans list cache
      if (previousLoans) {
        queryClient.setQueryData<LoanWithCustomer[]>(queryKeys.loans.all, [
          optimistic,
          ...previousLoans,
        ])
      }

      return { previousLoans, optimisticId: optimistic.id }
    },
    onError: (_err, _input, context) => {
      if (context?.previousLoans) {
        queryClient.setQueryData(queryKeys.loans.all, context.previousLoans)
      }
      toast.error("Failed to issue loan")
    },
    onSuccess: (result, _input, context) => {
      if ("error" in result) {
        // Rollback on server validation error
        if (context?.previousLoans) {
          queryClient.setQueryData(queryKeys.loans.all, context.previousLoans)
        }
        if (
          result.error === "Incomplete loan requirements" &&
          "details" in result
        ) {
          const details = result.details as { missing?: string[] }
          toast.error(
            `Missing fields: ${details.missing?.join(", ") ?? "unknown"}`,
          )
        } else {
          toast.error(result.error)
        }
        return
      }

      toast.success("Loan issued successfully")
      // Navigation is now handled by the caller via per-call onSuccess
      // to allow showing the POS receipt modal first
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({
        queryKey: queryKeys.loans.byCustomer(input.customerId),
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })
}
