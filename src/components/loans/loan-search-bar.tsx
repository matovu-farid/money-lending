"use client"

import { useEffect, useRef } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Input } from "@/components/ui/input"

interface LoanSearchBarProps {
  value: string
  onChange: (value: string) => void
  onSearch: (query: string) => void
  resetKey?: number
}

export function LoanSearchBar({
  value,
  onChange,
  onSearch,
  resetKey = 0,
}: LoanSearchBarProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
  }, [resetKey])

  const scheduleSearch = (nextValue: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      onSearch(nextValue.trim())
    }, 300)
  }

  const handleChange = (nextValue: string) => {
    onChange(nextValue)
    scheduleSearch(nextValue)
  }

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    onChange("")
    onSearch("")
  }

  return (
    <FilterPanel label="Filters" activeCount={value.trim() ? 1 : 0}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-[320px]">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search by customer name..."
            className="pl-9"
            placeholder="Search by customer name..."
            value={value}
            onChange={(event) => handleChange(event.target.value)}
          />
        </div>
        {value && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <X className="h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>
    </FilterPanel>
  )
}
