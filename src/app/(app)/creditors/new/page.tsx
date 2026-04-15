"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Redirect to the main creditors page — creditor creation now uses
 * an inline dialog instead of a separate page.
 */
export default function NewCreditorPage() {
  const router = useRouter()
  useEffect(() => { router.replace("/creditors") }, [router])
  return null
}
