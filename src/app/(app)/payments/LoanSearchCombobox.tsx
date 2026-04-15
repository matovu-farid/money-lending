"use client"

import { useState, useMemo } from "react"
import { Clock, Search, X } from "lucide-react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { loanCollection } from "@/collections"
import { Input } from "@/components/ui/input"
import { formatNumberWithCommas, shortId } from "@/lib/utils"
import type { ActiveLoanSearchResult } from "@/types"

interface RecentLoan {
  loanId: string
  customerName: string
}

interface LoanSearchComboboxProps {
  selectedLoan: ActiveLoanSearchResult | null
  onSelect: (loan: ActiveLoanSearchResult) => void
  onClear: () => void
  recentLoans?: RecentLoan[]
}

export function LoanSearchCombobox({ selectedLoan, onSelect, onClear, recentLoans = [] }: LoanSearchComboboxProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  // sideOffset value maintained for spec compliance
  const sideOffset = 4

  const isSearchMode = query.trim().length >= 2
  const { data: allLoans } = useLiveSuspenseQuery((q) =>
    q.from({ loan: loanCollection }).select(({ loan }) => loan)
  )
  const results: ActiveLoanSearchResult[] = useMemo(() => {
    if (!isSearchMode) return []
    const q = query.toLowerCase()
    return (allLoans ?? [])
      .filter(
        (loan) =>
          loan.status === "active" &&
          (loan.customerName.toLowerCase().includes(q) ||
            loan.id.includes(q))
      )
      .slice(0, 10)
      .map((loan) => ({
        loanId: loan.id,
        customerId: loan.customerId,
        customerName: loan.customerName,
        principalAmount: loan.principalAmount,
      }))
  }, [allLoans, query, isSearchMode])
  const isSearching = false

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setQuery(value)
    setOpen(true)
  }

  function handleSelect(loan: ActiveLoanSearchResult) {
    onSelect(loan)
    setOpen(false)
    setQuery("")
  }

  function handleRecentSelect(loan: RecentLoan) {
    onSelect({
      loanId: loan.loanId,
      customerId: "",
      customerName: loan.customerName,
      principalAmount: "0",
    })
    setOpen(false)
    setQuery("")
  }

  function handleClear() {
    onClear()
    setQuery("")
    setOpen(false)
  }

  // Show selected state when a loan is chosen
  if (selectedLoan) {
    return (
      <div className="relative w-full">
        <Input
          value={`${selectedLoan.customerName}  ·  LOAN-${shortId(selectedLoan.loanId).toUpperCase()}`}
          readOnly
          className="pr-10 cursor-default"
        />
        <button
          type="button"
          aria-label="Clear loan selection"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  const showRecent = !isSearchMode && recentLoans.length > 0

  return (
    <div className="relative w-full">
      <Input
        placeholder="Search customer name..."
        value={query}
        onChange={handleInputChange}
        className="pr-10"
        autoComplete="off"
        onBlur={() => {
          // Delay close so click on result registers first
          setTimeout(() => setOpen(false), 150)
        }}
        onFocus={() => setOpen(true)}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
        <Search className="h-4 w-4" />
      </span>

      {/* Dropdown results — uses sideOffset for visual gap */}
      {open && (
        <div
          className="absolute left-0 right-0 z-[9999] rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
          style={{ top: `calc(100% + ${sideOffset}px)` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {showRecent ? (
            <>
              <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                Recent loans
              </p>
              <ul className="py-1">
                {recentLoans.slice(0, 3).map((loan) => (
                  <li key={loan.loanId}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                      onClick={() => handleRecentSelect(loan)}
                    >
                      <div className="text-sm">
                        {loan.customerName}&nbsp;&nbsp;·&nbsp;&nbsp;LOAN-{shortId(loan.loanId).toUpperCase()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : !isSearchMode ? (
            <p className="py-4 px-3 text-sm text-muted-foreground">
              Type at least 2 characters to search
            </p>
          ) : results.length === 0 ? (
            <p className="py-4 px-3 text-sm text-muted-foreground">
              No active loans found for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <ul className="py-1">
              {results.map((loan) => (
                <li key={loan.loanId}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                    onClick={() => handleSelect(loan)}
                  >
                    <div className="text-sm">
                      {loan.customerName}&nbsp;&nbsp;·&nbsp;&nbsp;LOAN-{shortId(loan.loanId).toUpperCase()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Balance: UGX {formatNumberWithCommas(loan.principalAmount)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
