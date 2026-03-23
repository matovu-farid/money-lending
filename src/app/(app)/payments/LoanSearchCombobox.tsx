"use client"

import { useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { searchActiveLoansAction } from "@/actions/payment.actions"
import { formatNumberWithCommas } from "@/lib/utils"
import type { ActiveLoanSearchResult } from "@/types"

interface LoanSearchComboboxProps {
  selectedLoan: ActiveLoanSearchResult | null
  onSelect: (loan: ActiveLoanSearchResult) => void
  onClear: () => void
}

export function LoanSearchCombobox({ selectedLoan, onSelect, onClear }: LoanSearchComboboxProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<ActiveLoanSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // sideOffset value maintained for spec compliance
  const sideOffset = 4

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setQuery(value)

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    if (value.trim().length < 2) {
      setOpen(false)
      setResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    setOpen(true)

    debounceTimer.current = setTimeout(async () => {
      const result = await searchActiveLoansAction(value)
      setIsSearching(false)
      if ("error" in result) {
        setResults([])
      } else {
        setResults(result.data.slice(0, 10))
      }
    }, 200)
  }

  function handleSelect(loan: ActiveLoanSearchResult) {
    onSelect(loan)
    setOpen(false)
    setQuery("")
    setResults([])
  }

  function handleClear() {
    onClear()
    setQuery("")
    setResults([])
    setOpen(false)
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
  }

  // Show selected state when a loan is chosen
  if (selectedLoan) {
    return (
      <div className="relative w-full">
        <Input
          value={`${selectedLoan.customerName}  ·  LOAN-${selectedLoan.loanId.slice(0, 8).toUpperCase()}`}
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
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true)
        }}
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
          {isSearching ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner>Searching...</Spinner>
            </div>
          ) : query.trim().length < 2 ? (
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
                      {loan.customerName}&nbsp;&nbsp;·&nbsp;&nbsp;LOAN-{loan.loanId.slice(0, 8).toUpperCase()}
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
