"use client";

import { useState, useTransition } from "react";
import { approveHistoricalRateRepairAction } from
  "@/actions/historical-rate-repair.actions";
import { Button } from "@/components/ui/button";

type ReviewIdentity = {
  loanId: string; asOf: string; policyVersion: string;
  planHash: string; inputFingerprint: string;
};

export function ReviewApprovalForm({ input }: { input: ReviewIdentity }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const result = await approveHistoricalRateRepairAction({
          ...input, reviewNote: note,
        });
        if ("error" in result) setError(result.error);
        else setApprovalId(result.data.approvalId);
      } catch {
        setError("Approval could not be recorded. Please refresh the exact plan and try again.");
      }
    });
  }

  if (approvalId) return <p role="status" className="rounded-lg border p-4">
    Exact correction approved. Approval ID: <span className="font-mono">{approvalId}</span>
  </p>;

  return <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
    <label htmlFor="review-note" className="block font-medium">Administrator review note</label>
    <textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)}
      required minLength={15} rows={3} aria-describedby="review-note-help"
      className="w-full rounded-md border bg-background p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <p id="review-note-help" className="text-sm text-muted-foreground">
      State what you checked. This note and your signed-in identity are saved with the plan hash.
    </p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending || note.trim().length < 15}>
      {pending ? "Recording approval…" : "Approve exact correction"}
    </Button>
  </form>;
}
