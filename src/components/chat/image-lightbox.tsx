"use client"

import { useEffect } from "react"
import { X } from "lucide-react"

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ src, alt = "Image", onClose }: ImageLightboxProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Image preview"
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 h-8 w-8 rounded-full bg-background/80 text-foreground flex items-center justify-center hover:bg-background transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
