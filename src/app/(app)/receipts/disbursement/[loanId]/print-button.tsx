"use client"

import { Button } from "@/components/ui/button"

export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button onClick={() => window.print()} disabled={disabled}>
      Print Receipt
    </Button>
  )
}
