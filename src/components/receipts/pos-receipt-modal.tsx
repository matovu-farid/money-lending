"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Printer, X, Loader2 } from "lucide-react"
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
  /** When true, automatically saves image and prints when the modal opens */
  autoActions?: boolean
}

const PRINT_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: "Courier New", Courier, monospace;
    font-size: 14px;
    line-height: 1.35;
    background: white;
    color: black;
    padding: 4mm;
    width: 80mm;
    max-width: 80mm;
    overflow: hidden;
  }
  .border-t { border-top: 1px dashed black; margin: 4px 0; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .font-bold, .font-semibold { font-weight: bold; }
  .uppercase { text-transform: uppercase; }
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
`

export function PosReceiptModal({
  open,
  onClose,
  children,
  title = "Receipt",
  autoActions = false,
}: PosReceiptModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  const autoActionsRan = useRef(false)

  const handleDownloadImage = useCallback(async () => {
    const receiptEl = receiptRef.current?.querySelector(".pos-receipt") as HTMLElement | null
    if (!receiptEl) return

    setDownloading(true)
    try {
      const { domToPng } = await import("modern-screenshot")
      const dataUrl = await domToPng(receiptEl, {
        scale: 2,
        backgroundColor: "#ffffff",
      })

      const link = document.createElement("a")
      link.download = `receipt-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error("Failed to capture receipt:", err)
    } finally {
      setDownloading(false)
    }
  }, [])

  const handlePrint = useCallback(() => {
    const receiptEl = receiptRef.current?.querySelector(".pos-receipt")
    if (!receiptEl) return

    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.left = "-9999px"
    iframe.style.top = "-9999px"
    iframe.style.width = "80mm"
    iframe.style.height = "auto"
    document.body.appendChild(iframe)

    const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
    if (!iframeDoc) {
      document.body.removeChild(iframe)
      return
    }

    const style = iframeDoc.createElement("style")
    style.textContent = PRINT_STYLES
    iframeDoc.head.appendChild(style)
    iframeDoc.title = title

    const clone = receiptEl.cloneNode(true) as HTMLElement
    clone.style.maxWidth = "none"
    clone.style.margin = "0"
    clone.style.padding = "0"
    clone.style.fontFamily = "'Courier New', Courier, monospace"
    clone.style.fontSize = "14px"
    clone.style.lineHeight = "1.35"
    iframeDoc.body.appendChild(clone)

    setTimeout(() => {
      const contentHeight = iframeDoc.body.scrollHeight
      const pageStyle = iframeDoc.createElement("style")
      const heightMm = Math.ceil(contentHeight * 0.2646)
      pageStyle.textContent = `@page { size: 80mm ${heightMm + 4}mm; margin: 0; }`
      iframeDoc.head.appendChild(pageStyle)

      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe)
      }, 1000)
    }, 250)
  }, [title])

  // Auto-trigger save image + print when modal opens with autoActions enabled
  useEffect(() => {
    if (!open || !autoActions || autoActionsRan.current) return
    const timer = setTimeout(async () => {
      autoActionsRan.current = true
      await handleDownloadImage()
      // Small delay to let the download kick off before printing
      setTimeout(() => {
        handlePrint()
      }, 500)
    }, 300)
    return () => clearTimeout(timer)
  }, [open, autoActions, handleDownloadImage, handlePrint])

  // Reset auto-actions flag when modal closes
  useEffect(() => {
    if (!open) {
      autoActionsRan.current = false
    }
  }, [open])

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

        <div ref={receiptRef} className="flex justify-center">{children}</div>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </Button>
          <Button variant="outline" onClick={handleDownloadImage} disabled={downloading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Save Image
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
