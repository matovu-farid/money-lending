"use client"

import { useState, useTransition } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import { Loader2, ArrowRightLeft, PlusCircle } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { ROLE_LEVELS, type UserRole } from "@/types"
import { PermissionInfo } from "@/components/ui/permission-info"
import { DEPOSIT_LOCATION_OPTIONS, DEPOSIT_LOCATION_SHORT_LABELS } from "@/lib/constants"
import { createFundTransferAction, createCapitalInjectionAction, listFundTransfersAction } from "@/actions/fund-transfer.actions"
import { queryKeys } from "@/hooks/query-keys"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/ui/money-input"
import { PageHeader } from "@/components/ui/page-header"
import { InfoPopover } from "@/components/ui/info-popover"
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

interface TransferFormValues {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string
  note: string
}

interface InjectionFormValues {
  toLocation: DepositLocation
  amount: string
  note: string
}

export default function FundTransfersPage() {
  const { data: session } = useSession()
  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const isAdmin = actorLevel >= ROLE_LEVELS.admin

  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [injectionDialogOpen, setInjectionDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: queryKeys.fundTransfers.all,
    queryFn: async () => {
      const result = await listFundTransfersAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    enabled: !!session && isAdmin,
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

  const injectionForm = useForm<InjectionFormValues>({
    defaultValues: {
      toLocation: "cash",
      amount: "",
      note: "",
    },
  })

  function onInjectionSubmit(data: InjectionFormValues) {
    startTransition(async () => {
      const result = await createCapitalInjectionAction({
        toLocation: data.toLocation,
        amount: data.amount.trim(),
        note: data.note.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success("Capital injection recorded")
      injectionForm.reset()
      setInjectionDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.fundTransfers.all })
    })
  }

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
      await queryClient.invalidateQueries({ queryKey: queryKeys.fundTransfers.all })
    })
  }

  if (!session) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="admin" action="Access fund transfers" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Admin or higher permissions to view fund transfers.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Fund Transfers"
          subtitle={
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1 inline-flex items-center gap-1">
              Move money between cash, bank, and strong room
              <InfoPopover>
                <p className="font-semibold text-sm mb-1">Fund Transfers</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Record movements of money between your three deposit locations. This updates the balance sheet to reflect where funds are physically held.
                </p>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>Cash</strong> — Physical cash on hand at the office.</p>
                  <p><strong>Bank</strong> — Funds held in the business bank account.</p>
                  <p><strong>Strong Room</strong> — Cash stored in the secure vault/strong room.</p>
                </div>
              </InfoPopover>
            </p>
          }
        />
        <div className="flex items-center gap-2">
        <Dialog open={injectionDialogOpen} onOpenChange={setInjectionDialogOpen}>
          <DialogTrigger
            render={
              <Button variant="outline">
                <PlusCircle className="mr-2 h-4 w-4" />
                Capital Injection
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Capital Injection</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Bring money into the business from shareholders or owners.
            </p>
            <form onSubmit={injectionForm.handleSubmit(onInjectionSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="injectionToLocation">Deposit To</Label>
                <Controller
                  name="toLocation"
                  control={injectionForm.control}
                  rules={{ required: "Deposit location is required" }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                      <SelectTrigger id="injectionToLocation">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {injectionForm.formState.errors.toLocation && (
                  <p className="text-sm text-destructive">{injectionForm.formState.errors.toLocation.message}</p>
                )}
              </div>

              <MoneyInput
                name="amount"
                control={injectionForm.control}
                label="Amount (UGX)"
                required="Amount is required"
                disabled={isPending}
                id="injectionAmount"
              />

              <div className="space-y-1">
                <Label htmlFor="injectionNote">Note (optional)</Label>
                <Controller
                  name="note"
                  control={injectionForm.control}
                  render={({ field }) => (
                    <Textarea
                      id="injectionNote"
                      placeholder="e.g. Shareholder contribution..."
                      disabled={isPending}
                      maxLength={2500}
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
                  "Record Injection"
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
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
                        {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
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
                        {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
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
                      maxLength={2500}
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
                  <TableHead>Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => {
                  const isInjection = t.transferType === "capital_injection"
                  return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono tabular-nums text-sm">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell>
                      {isInjection ? (
                        <Badge variant="outline" className="rounded-full bg-emerald-50 text-emerald-700 border-emerald-200">
                          Capital In
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-full bg-blue-50 text-blue-700 border-blue-200">
                          Transfer
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{t.fromLocation ? DEPOSIT_LOCATION_SHORT_LABELS[t.fromLocation as DepositLocation] : "-"}</TableCell>
                    <TableCell>{t.toLocation ? DEPOSIT_LOCATION_SHORT_LABELS[t.toLocation as DepositLocation] : "-"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(t.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                      {t.note || "-"}
                    </TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
