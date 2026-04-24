"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"

interface ChangeNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
}

export function ChangeNameDialog({ open, onOpenChange, currentName }: ChangeNameDialogProps) {
  const [name, setName] = useState(currentName)
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) return

    setIsPending(true)
    try {
      const { error } = await authClient.updateUser({ name: trimmed })
      if (error) {
        toast.error("Failed to update name")
        return
      }
      toast.success("Name updated")
      onOpenChange(false)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Change Name</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="userName">Name</Label>
            <Input
              id="userName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) handleSubmit()
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
