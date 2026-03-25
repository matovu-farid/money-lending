"use client"

import * as React from "react"
import { useMediaQuery } from "@base-ui/react/unstable-use-media-query"
import { Drawer } from "@base-ui/react/drawer"
import { XIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface DrawerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

function DrawerDialog({ open, onOpenChange, children }: DrawerDialogProps) {
  // defaultMatches: true = assume desktop on SSR to avoid bottom-drawer flash on desktop
  const isDesktop = useMediaQuery("(min-width: 768px)", { defaultMatches: true })

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
      </Dialog>
    )
  }

  return (
    <Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)} swipeDirection="down">
      {children}
    </Drawer.Root>
  )
}

interface DrawerDialogContentProps {
  className?: string
  children: React.ReactNode
  showCloseButton?: boolean
  [key: string]: unknown
}

function DrawerDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DrawerDialogContentProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)", { defaultMatches: true })

  if (isDesktop) {
    return (
      <DialogContent className={className} showCloseButton={showCloseButton} {...props}>
        {children}
      </DialogContent>
    )
  }

  return (
    <Drawer.Portal>
      <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-[24px]" />
      <Drawer.Viewport className="fixed inset-0 z-50 flex items-end pointer-events-none">
        <Drawer.Popup
          data-slot="drawer-dialog-content"
          className={cn(
            "w-full flex flex-col bg-white/85 rounded-t-xl p-4 max-h-[90dvh] overflow-y-auto pointer-events-auto",
            "data-open:animate-in data-open:slide-in-from-bottom",
            "data-closed:animate-out data-closed:slide-out-to-bottom",
            className
          )}
          {...props}
        >
          {/* Drag handle */}
          <div className="mx-auto mb-4 h-2 w-12 rounded-full bg-muted-foreground/30" />
          {children}
          {showCloseButton !== false && (
            <Drawer.Close
              render={
                <Button
                  variant="ghost"
                  className="absolute top-2 right-2"
                  size="icon-sm"
                  aria-label="Close"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Drawer.Close>
          )}
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  )
}

export { DrawerDialog, DrawerDialogContent }
