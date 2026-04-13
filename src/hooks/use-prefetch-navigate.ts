"use client"

import { useCallback, useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { prefetchQueue } from "@/lib/prefetch-queue"

/**
 * Navigation-aware hook that pauses the prefetch queue during navigation
 * and resumes it after the new page renders.
 *
 * Returns a `navigate` function that should be used instead of `router.push`
 * anywhere prefetching coexists with navigation.
 *
 * Also automatically pauses/resumes on pathname changes (covers <Link> clicks
 * that bypass the navigate function).
 */
export function usePrefetchNavigate() {
  const router = useRouter()
  const pathname = usePathname()
  const prevPathRef = useRef(pathname)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Detect pathname changes (from <Link>, back/forward, etc.) and resume
  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      // Path changed — navigation completed, resume prefetching
      prevPathRef.current = pathname
      clearTimeout(resumeTimerRef.current)
      // Small delay to let the new page's initial fetches fire first
      resumeTimerRef.current = setTimeout(() => {
        prefetchQueue.resume()
      }, 300)
    }
    return () => clearTimeout(resumeTimerRef.current)
  }, [pathname])

  /**
   * Navigate to a path, pausing prefetching for the duration.
   * Use this instead of `router.push()` in components that coexist
   * with the prefetch queue.
   */
  const navigate = useCallback(
    (href: string) => {
      prefetchQueue.pause()
      router.push(href)
      // Resume is handled by the pathname-change effect above.
      // Safety net: if pathname doesn't change (e.g. same-page nav),
      // resume after a generous timeout.
      clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = setTimeout(() => {
        prefetchQueue.resume()
      }, 3_000)
    },
    [router],
  )

  return { navigate, router }
}

/**
 * Hook for <Link> components in the sidebar / navigation.
 * Pauses the prefetch queue on click and resumes after navigation.
 *
 * Usage:
 *   const { onLinkClick } = usePrefetchAwareLink()
 *   <Link href="/foo" onClick={onLinkClick}>...</Link>
 */
export function usePrefetchAwareLink() {
  const pathname = usePathname()
  const prevPathRef = useRef(pathname)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      prevPathRef.current = pathname
      clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = setTimeout(() => {
        prefetchQueue.resume()
      }, 300)
    }
    return () => clearTimeout(resumeTimerRef.current)
  }, [pathname])

  const onLinkClick = useCallback(() => {
    prefetchQueue.pause()
    // Resume handled by pathname change above; safety net below
    clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      prefetchQueue.resume()
    }, 3_000)
  }, [])

  return { onLinkClick }
}
