"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PosReceiptModal } from "./pos-receipt-modal";
import {
  PosReceiptTransaction,
  type TransactionReceiptData,
} from "./pos-receipt-transaction";
import { getTransactionReceiptDataAction } from "@/actions/receipt.actions";
import { ReceiptInput } from "@/services/receipt.service";

interface Props {
  input: ReceiptInput;
  /** Auto-download image + print when receipt opens (use after a successful mutation). */
  autoActions?: boolean;
  /** Visual variant — defaults to icon button for in-row use; "default" works for after-success buttons. */
  variant?: "icon" | "default";
  label?: string;
}

/**
 * Generic receipt button for any money-movement event.
 * Pass `input={{ kind: "expense", transactionId: tx.id }}` (or the equivalent
 * per-kind shape) to trigger a printable POS receipt for that transaction.
 */
export function TransactionReceiptButton({
  input,
  autoActions = false,
  variant = "icon",
  label = "Receipt",
}: Props) {
  const [receipt, setReceipt] = useState<TransactionReceiptData | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const result = await getTransactionReceiptDataAction(input);
    setLoading(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setReceipt(result.data);
  }

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleClick}
          disabled={loading}
          aria-label="POS receipt"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Printer className="h-4 w-4" />
          )}
        </Button>
      ) : (
        <Button variant="outline" onClick={handleClick} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Printer className="h-4 w-4" />
          )}
          {label}
        </Button>
      )}
      <PosReceiptModal
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title={receipt?.headerTitle ?? "Receipt"}
        autoActions={autoActions}
      >
        {receipt && <PosReceiptTransaction data={receipt} />}
      </PosReceiptModal>
    </>
  );
}
