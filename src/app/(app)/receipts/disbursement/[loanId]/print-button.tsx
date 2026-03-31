"use client"

import { Button } from "@/components/ui/button"
import { Printer, ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"

export function PrintButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter()

  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => router.back()}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <Button onClick={() => window.print()} disabled={disabled}>
        <Printer className="h-4 w-4 mr-2" />
        Print Receipt
      </Button>
    </div>
  )
}
