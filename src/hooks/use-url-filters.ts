"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

interface UseUrlFiltersConfig<T extends Record<string, string>> {
  basePath: string
  defaults: T
  debounceMs?: number
}

export function useUrlFilters<T extends Record<string, string>>({
  basePath,
  defaults,
  debounceMs = 300,
}: UseUrlFiltersConfig<T>) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize from URL — `useState`'s lazy initializer runs exactly once,
  // capturing the first-render `searchParams` snapshot without re-reading it
  // on subsequent renders.
  const [filters, setFiltersState] = useState<T>(() => {
    const result = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof T & string)[]) {
      const val = searchParams.get(key)
      if (val) (result as Record<string, string>)[key] = val
    }
    return result
  })

  const page = Math.max(1, Number(searchParams.get("page")) || 1)

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const syncToUrl = useCallback(
    (updated: T) => {
      const params = new URLSearchParams()
      for (const [key, val] of Object.entries(updated)) {
        if (val && val !== (defaults as Record<string, string>)[key]) params.set(key, val)
      }
      params.delete("page")
      const qs = params.toString()
      router.push(qs ? `${basePath}?${qs}` : basePath)
    },
    [router, basePath, defaults]
  )

  const setFilter = useCallback(
    (key: keyof T & string, value: string) => {
      setFiltersState((prev) => {
        const next = { ...prev, [key]: value } as T
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => syncToUrl(next), debounceMs)
        return next
      })
    },
    [syncToUrl, debounceMs]
  )

  const clearFilters = useCallback(() => {
    setFiltersState({ ...defaults } as T)
    router.push(basePath)
  }, [defaults, router, basePath])

  const setPage = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("page", String(newPage))
      router.push(`${basePath}?${params.toString()}`)
    },
    [router, searchParams, basePath]
  )

  const hasFilters = Object.entries(filters).some(
    ([key, val]) => val !== (defaults as Record<string, string>)[key]
  )

  const activeFilterCount = Object.entries(filters).filter(
    ([key, val]) => val !== (defaults as Record<string, string>)[key]
  ).length

  return {
    filters,
    page,
    setFilter,
    clearFilters,
    setPage,
    hasFilters,
    activeFilterCount,
  }
}
