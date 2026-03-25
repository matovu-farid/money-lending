"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterPanel } from "@/components/ui/filter-panel"
import type { CustomerSearchParams, CustomerStatus, LoanStatus } from "@/types"

interface CustomerSearchBarProps {
  onSearch: (params: CustomerSearchParams) => void
  loading?: boolean
}

export function CustomerSearchBar({ onSearch, loading }: CustomerSearchBarProps) {
  const [name, setName] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [loanStatusFilter, setLoanStatusFilter] = useState<string>("all")
  const [daysFilter, setDaysFilter] = useState<string>("any")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerSearch = useCallback((overrides: Partial<{
    name: string
    statusFilter: string
    loanStatusFilter: string
    daysFilter: string
  }> = {}) => {
    const n = overrides.name ?? name
    const s = overrides.statusFilter ?? statusFilter
    const ls = overrides.loanStatusFilter ?? loanStatusFilter
    const d = overrides.daysFilter ?? daysFilter

    onSearch({
      name: n || undefined,
      status: s === "all" ? undefined : [s as CustomerStatus],
      loanStatus: ls === "all" ? undefined : [ls as LoanStatus],
      daysRemainingFilter: d as CustomerSearchParams["daysRemainingFilter"],
      page: 0,
    })
  }, [name, statusFilter, loanStatusFilter, daysFilter, onSearch])

  // Debounced name search (300ms)
  const handleNameChange = useCallback((value: string) => {
    setName(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      triggerSearch({ name: value })
    }, 300)
  }, [triggerSearch])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Immediate filter changes for Select dropdowns
  const handleStatusChange = useCallback((value: string | null) => {
    const v = value ?? "all"
    setStatusFilter(v)
    triggerSearch({ statusFilter: v })
  }, [triggerSearch])

  const handleLoanStatusChange = useCallback((value: string | null) => {
    const v = value ?? "all"
    setLoanStatusFilter(v)
    triggerSearch({ loanStatusFilter: v })
  }, [triggerSearch])

  const handleDaysFilterChange = useCallback((value: string | null) => {
    const v = value ?? "any"
    setDaysFilter(v)
    triggerSearch({ daysFilter: v })
  }, [triggerSearch])

  // Clear all filters
  const hasActiveFilters = name || statusFilter !== "all" || loanStatusFilter !== "all" || daysFilter !== "any"

  const activeFilterCount = [
    name !== "",
    statusFilter !== "all",
    loanStatusFilter !== "all",
    daysFilter !== "any",
  ].filter(Boolean).length

  const handleClearFilters = useCallback(() => {
    setName("")
    setStatusFilter("all")
    setLoanStatusFilter("all")
    setDaysFilter("any")
    onSearch({ page: 0 })
  }, [onSearch])

  return (
    <FilterPanel label="Filters" activeCount={activeFilterCount}>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="pl-9 max-w-sm"
            disabled={loading}
          />
        </div>

        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue>
              {{ all: "All Statuses", active: "Active", blacklisted: "Blacklisted", inactive: "Inactive" }[statusFilter] ?? statusFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="blacklisted">Blacklisted</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={loanStatusFilter} onValueChange={handleLoanStatusChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue>
              {{ all: "All Loan Status", active: "Active", fully_paid: "Fully Paid" }[loanStatusFilter] ?? loanStatusFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Loan Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="fully_paid">Fully Paid</SelectItem>
          </SelectContent>
        </Select>

        <Select value={daysFilter} onValueChange={handleDaysFilterChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue>
              {{ any: "Any", due_within_30: "Due within 30 days", overdue_30_plus: "Overdue (30+ days)" }[daysFilter] ?? daysFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="due_within_30">Due within 30 days</SelectItem>
            <SelectItem value="overdue_30_plus">Overdue (30+ days)</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>
    </FilterPanel>
  )
}
