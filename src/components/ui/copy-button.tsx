"use client"

import { useState, useCallback } from "react"
import { Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CopyButtonProps {
  value: string
}

export function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (non-HTTPS or denied permission)
    }
  }, [value])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className="h-6 w-6"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  )
}
