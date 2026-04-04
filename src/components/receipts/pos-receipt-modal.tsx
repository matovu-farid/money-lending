"use client"

import { useCallback } from "react"
import { Printer, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface PosReceiptModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
}

export function PosReceiptModal({
  open,
  onClose,
  children,
  title = "Receipt",
}: PosReceiptModalProps) {
  const handlePrint = useCallback(() => {
    document.body.classList.add("pos-receipt-print-active")

    const cleanup = () => {
      document.body.classList.remove("pos-receipt-print-active")
    }

    window.addEventListener("afterprint", cleanup, { once: true })
    window.print()
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[380px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center">{children}</div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
