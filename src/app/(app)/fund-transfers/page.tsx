"use client"

import { useState, useTransition } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import { Loader2, ArrowRightLeft } from "lucide-react"
import { toast } from "sonner"
import { createFundTransferAction, listFundTransfersAction } from "@/actions/fund-transfer.actions"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/ui/money-input"
import { PageHeader } from "@/components/ui/page-header"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { DepositLocation } from "@/types"

const LOCATION_LABELS: Record<DepositLocation, string> = {
  cash: "Cash",
  bank: "Bank",
  strong_room: "Strong Room",
}

interface TransferFormValues {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string
  note: string
}

export default function FundTransfersPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["fund-transfers"],
    queryFn: async () => {
      const result = await listFundTransfersAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<TransferFormValues>({
    defaultValues: {
      fromLocation: "cash",
      toLocation: "bank",
      amount: "",
      note: "",
    },
  })

  const fromLocation = watch("fromLocation")

  function onSubmit(data: TransferFormValues) {
    if (data.fromLocation === data.toLocation) {
      toast.error("Source and destination must be different")
      return
    }

    startTransition(async () => {
      const result = await createFundTransferAction({
        fromLocation: data.fromLocation,
        toLocation: data.toLocation,
        amount: data.amount.trim(),
        note: data.note.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success("Fund transfer recorded")
      reset()
      setDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: ["fund-transfers"] })
    })
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Fund Transfers"
          subtitle="Move money between cash, bank, and strong room"
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                New Transfer
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Fund Transfer</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="fromLocation">From</Label>
                <Controller
                  name="fromLocation"
                  control={control}
                  rules={{ required: "Source is required" }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                      <SelectTrigger id="fromLocation">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="strong_room">Strong Room</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.fromLocation && (
                  <p className="text-sm text-destructive">{errors.fromLocation.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="toLocation">To</Label>
                <Controller
                  name="toLocation"
                  control={control}
                  rules={{
                    required: "Destination is required",
                    validate: (v) => v !== fromLocation || "Source and destination must be different",
                  }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                      <SelectTrigger id="toLocation">
                        <SelectValue placeholder="Select destination" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="strong_room">Strong Room</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.toLocation && (
                  <p className="text-sm text-destructive">{errors.toLocation.message}</p>
                )}
              </div>

              <MoneyInput
                name="amount"
                control={control}
                label="Amount (UGX)"
                required="Amount is required"
                disabled={isPending}
                id="transferAmount"
              />

              <div className="space-y-1">
                <Label htmlFor="transferNote">Note (optional)</Label>
                <Controller
                  name="note"
                  control={control}
                  render={({ field }) => (
                    <Textarea
                      id="transferNote"
                      placeholder="Reason for transfer..."
                      disabled={isPending}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Recording...
                  </>
                ) : (
                  "Record Transfer"
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
            </div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No fund transfers recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono tabular-nums text-sm">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell>{LOCATION_LABELS[t.fromLocation as DepositLocation]}</TableCell>
                    <TableCell>{LOCATION_LABELS[t.toLocation as DepositLocation]}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(t.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                      {t.note || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
