"use client"

import { Suspense } from "react"
import { PaymentsClient } from "./PaymentsClient"

export default function PaymentsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <Suspense fallback={<div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded-md bg-muted-foreground/10 animate-pulse" />)}</div>}>
        <PaymentsClient />
      </Suspense>
    </div>
  )
}
