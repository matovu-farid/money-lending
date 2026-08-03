export function filterLoansByCustomerName<T extends { customerName: string }>(
  loans: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...loans]

  return loans.filter((loan) =>
    loan.customerName.toLowerCase().includes(normalizedQuery),
  )
}

type LoanExportFilter = "all" | "critical" | "at-risk" | "early" | undefined

export function filterLoansForExport<
  T extends { customerName: string; daysOverdue: number },
>(
  loans: readonly T[],
  options: { filter?: LoanExportFilter; customerName?: string },
): T[] {
  let entries = filterLoansByCustomerName(loans, options.customerName ?? "")

  if (options.filter && options.filter !== "all") {
    entries = entries.filter((entry) => {
      if (entry.daysOverdue < 0) return false
      if (options.filter === "critical") return entry.daysOverdue >= 30
      if (options.filter === "at-risk") {
        return entry.daysOverdue >= 25 && entry.daysOverdue < 30
      }
      if (options.filter === "early") {
        return entry.daysOverdue >= 0 && entry.daysOverdue < 25
      }
      return true
    })
  }

  return entries
}
