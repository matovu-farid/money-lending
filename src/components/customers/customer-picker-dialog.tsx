"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Search, Loader2 } from "lucide-react"
import { searchCustomersAction, getCustomerAction } from "@/actions/customer.actions"
import { queryKeys } from "@/hooks/query-keys"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { Input } from "@/components/ui/input"
import type { Customer } from "@/types"

interface CustomerPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CustomerPickerDialog({ open, onOpenChange }: CustomerPickerDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch 3 most recent customers (cached by TanStack Query, prefetchable)
  const { data: recentCustomers = [] } = useQuery({
    queryKey: queryKeys.customers.recent(),
    queryFn: async () => {
      const res = await searchCustomersAction({ page: 0, pageSize: 3, sortByRecent: true })
      if ("data" in res && res.data) return res.data.rows
      return []
    },
    enabled: open,
    staleTime: 30_000,
  })

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("")
      setSearchResults([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const search = useCallback(async (name: string) => {
    if (!name.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await searchCustomersAction({ name, page: 0, pageSize: 10 })
      if ("data" in res && res.data) {
        setSearchResults(res.data.rows)
      }
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = useCallback((value: string) => {
    setQuery(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }, [search])

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  function handleSelect(customer: Customer) {
    router.prefetch(`/loans/new?customerId=${customer.id}`)
    queryClient.prefetchQuery({
      queryKey: queryKeys.customers.detail(customer.id),
      queryFn: () => getCustomerAction(customer.id),
      staleTime: 30_000,
    })
    onOpenChange(false)
    router.push(`/loans/new?customerId=${customer.id}`)
  }

  const isSearching = query.trim().length > 0
  const displayList = isSearching ? searchResults : recentCustomers

  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent className="sm:max-w-md">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Select Customer</h2>
            <p className="text-sm text-muted-foreground">Search for the customer to issue a loan to.</p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search by name..."
              value={query}
              onChange={(e) => handleChange(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="min-h-[200px] max-h-[300px] overflow-y-auto">
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : displayList.length > 0 ? (
              <>
                {!isSearching && (
                  <p className="text-xs font-medium text-muted-foreground px-3 pb-1">Recent customers</p>
                )}
                <ul className="space-y-1">
                  {displayList.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(c)}
                        className="w-full text-left rounded-md px-3 py-2.5 hover:bg-accent transition-colors"
                      >
                        <p className="text-sm font-medium">{c.fullName}</p>
                        <p className="text-xs text-muted-foreground">{c.contact}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : isSearching ? (
              <p className="text-sm text-muted-foreground text-center py-8">No customers found.</p>
            ) : null}
          </div>
        </div>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
