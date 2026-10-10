"use client"

import { useState, useTransition } from "react"
import { approvePortfolioAccrualRepairAction } from
  "@/actions/portfolio-accrual-repair.actions"
import { Button } from "@/components/ui/button"

type ReviewIdentity = {
  loanId: string
  asOf: string
  policyVersion: string
  planHash: string
  inputFingerprint: string
}

export function ReviewApprovalForm({ input }: { input: ReviewIdentity }) {
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [approvalId, setApprovalId] = useState("")
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    startTransition(async () => {
      try {
        const result = await approvePortfolioAccrualRepairAction({ ...input, reviewNote: note })
        if ("error" in result) setError(result.error)
        else setApprovalId(result.data.approvalId)
      } catch {
        setError("Approval could not be recorded. Refresh the exact plan and try again.")
      }
    })
  }

  if (approvalId) return <p role="status" className="rounded-lg border p-4">
    Exact accrual plan approved. Approval ID: <span className="font-mono">{approvalId}</span>
  </p>

  return <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
    <label htmlFor="accrual-review-note" className="block font-medium">Administrator review note</label>
    <textarea id="accrual-review-note" value={note}
      onChange={(event) => setNote(event.target.value)} required minLength={15} rows={3}
      aria-describedby="accrual-review-note-help"
      className="w-full rounded-md border bg-background p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <p id="accrual-review-note-help" className="text-sm text-muted-foreground">
      State the dates and amounts you checked. Your signed-in identity and note are saved with this exact plan hash.
    </p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending || note.trim().length < 15}>
      {pending ? "Recording approval…" : "Approve exact accrual plan"}
    </Button>
  </form>
}
