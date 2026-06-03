"use client"

import { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export interface SummaryLine {
  label: string
  value: ReactNode
  /** Show in a heavier weight — use for the headline amount / total. */
  emphasis?: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  lines: SummaryLine[]
  /** Optional free-form block under the lines (e.g. a warning, a note). */
  footnote?: ReactNode
  confirmLabel?: string
  goBackLabel?: string
  /** Visual tone for the confirm button — default keeps the primary look. */
  confirmVariant?: "default" | "destructive"
  isPending?: boolean
  onConfirm: () => void | Promise<void>
}

/**
 * Review-and-confirm dialog. Forms hand the validated values off here so
 * the user can verify each field, jump back to edit, or commit. Sits
 * between the form submission and the actual mutation so the
 * post-success receipt only fires after explicit confirmation.
 */
export function ConfirmSummaryDialog({
  open,
  onOpenChange,
  title,
  description,
  lines,
  footnote,
  confirmLabel = "Confirm & save",
  goBackLabel = "Go back",
  confirmVariant = "default",
  isPending = false,
  onConfirm,
}: Props) {
  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3 py-2">
          <dl className="divide-y rounded-lg border bg-muted/30">
            {lines.map((line, idx) => (
              <div
                key={`${line.label}-${idx}`}
                className="flex items-baseline justify-between gap-4 px-3 py-2"
              >
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  {line.label}
                </dt>
                <dd
                  className={
                    line.emphasis
                      ? "text-base font-semibold tabular-nums text-right"
                      : "text-sm tabular-nums text-right"
                  }
                >
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
          {footnote && <div className="text-xs text-muted-foreground">{footnote}</div>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {goBackLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={() => void onConfirm()}
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
