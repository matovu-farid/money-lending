"use client"

import { useState } from "react"
import { useLiveQuery } from "@tanstack/react-db"
import { fundTransferCollection, insertFundTransferWithInput, insertCapitalInjectionWithInput } from "@/collections/fund-transfers"
import { bankAccountCollection } from "@/collections/bank-accounts"
import { locationBalancesCollection } from "@/collections/loan-extras"
import { useForm, Controller } from "react-hook-form"
import { ArrowRightLeft, PlusCircle, MoreHorizontal, Building2 } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { usePermissions } from "@/hooks/use-permissions"
import { PermissionInfo } from "@/components/ui/permission-info"
import { DEPOSIT_LOCATION_OPTIONS, DEPOSIT_LOCATION_SHORT_LABELS } from "@/lib/constants"
import { generateClientId } from "@/lib/client-id"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/ui/money-input"
import { PageHeader } from "@/components/ui/page-header"
import { InfoPopover } from "@/components/ui/info-popover"
import { BankAccountSelect } from "@/components/ui/bank-account-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { DepositLocation, BankAccount } from "@/types"
import type { FundTransfer } from "@/types/fund-transfer"

interface TransferFormValues {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  fromSubLocationId: string
  toSubLocationId: string
  amount: string
  note: string
}

interface InjectionFormValues {
  toLocation: DepositLocation
  toSubLocationId: string
  amount: string
  note: string
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
      <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}

function FundTransfersContent({ session }: { session: { user: { id: string } } }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [injectionDialogOpen, setInjectionDialogOpen] = useState(false)
  const [bankAccountDialogOpen, setBankAccountDialogOpen] = useState(false)
  const { has } = usePermissions()
  const isAdmin = has("fund-transfer:create")

  const bankAccountForm = useForm<{ name: string }>({ defaultValues: { name: "" } })

  const { data: allTransfers, isLoading: transfersLoading } = useLiveQuery((q) =>
    q.from({ ft: fundTransferCollection }).select(({ ft }) => ft)
  )
  const transfers = allTransfers ?? []

  const { data: allBankAccounts, isLoading: bankAccountsLoading } = useLiveQuery((q) =>
    q.from({ ba: bankAccountCollection }).select(({ ba }) => ba)
  )
  const bankAccountsList = allBankAccounts ?? []

  const { data: locationBalanceRows, isLoading: balancesLoading } = useLiveQuery((q) =>
    q.from({ lb: locationBalancesCollection }).select(({ lb }) => lb)
  )
  const locationBalances = locationBalanceRows?.[0] ?? null
  const bankAccountBalances = (locationBalances as any)?.bankAccounts ?? {}

  const isInitialLoading =
    (transfersLoading && !allTransfers) ||
    (bankAccountsLoading && !allBankAccounts) ||
    (balancesLoading && !locationBalanceRows)

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
      fromSubLocationId: "",
      toSubLocationId: "",
      amount: "",
      note: "",
    },
  })

  const fromLocation = watch("fromLocation")

  const injectionForm = useForm<InjectionFormValues>({
    defaultValues: {
      toLocation: "cash",
      toSubLocationId: "",
      amount: "",
      note: "",
    },
  })

  // NOTE: We deliberately do NOT wrap these handlers in useTransition. The
  // optimistic insert from TanStack DB renders the new row immediately, so the
  // user already sees the result. Wrapping the dialog-close + form-reset state
  // updates in startTransition would defer them and gate them on the same
  // transition that includes any heavy re-renders triggered by the optimistic
  // mutation, which made submit feel laggy. Failures roll back the optimistic
  // row automatically via the collection's onInsert handler.

  function onCreateBankAccount(data: { name: string }) {
    const optimistic: BankAccount = {
      id: generateClientId(),
      name: data.name.trim(),
      isActive: true,
      createdBy: session.user.id,
      createdAt: new Date(),
    }
    try {
      bankAccountCollection.insert(optimistic)
      toast.success("Bank account created")
      bankAccountForm.reset()
      setBankAccountDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bank account")
    }
  }

  function onInjectionSubmit(data: InjectionFormValues) {
    const id = generateClientId()
    const input = {
      id,
      toLocation: data.toLocation,
      amount: data.amount.trim(),
      note: data.note.trim() || undefined,
      toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : undefined,
    }
    const optimistic: FundTransfer = {
      id,
      transferType: "capital_injection",
      fromLocation: null,
      toLocation: data.toLocation,
      fromSubLocationId: null,
      toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : null,
      amount: data.amount.trim(),
      transferredBy: session.user.id,
      note: data.note.trim() || null,
      createdAt: new Date(),
    }

    try {
      insertCapitalInjectionWithInput(id, optimistic, input)
      toast.success("Capital injection recorded")
      injectionForm.reset()
      setInjectionDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record injection")
    }
  }

  function onSubmit(data: TransferFormValues) {
    if (data.fromLocation === data.toLocation) {
      toast.error("Source and destination must be different")
      return
    }

    const id = generateClientId()
    const input = {
      id,
      fromLocation: data.fromLocation,
      toLocation: data.toLocation,
      amount: data.amount.trim(),
      note: data.note.trim() || undefined,
      fromSubLocationId: data.fromLocation === "bank" ? data.fromSubLocationId : undefined,
      toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : undefined,
    }
    const optimistic: FundTransfer = {
      id,
      transferType: "internal",
      fromLocation: data.fromLocation,
      toLocation: data.toLocation,
      fromSubLocationId: data.fromLocation === "bank" ? data.fromSubLocationId : null,
      toSubLocationId: data.toLocation === "bank" ? data.toSubLocationId : null,
      amount: data.amount.trim(),
      transferredBy: session.user.id,
      note: data.note.trim() || null,
      createdAt: new Date(),
    }

    try {
      insertFundTransferWithInput(id, optimistic, input)
      toast.success("Fund transfer recorded")
      reset()
      setDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record transfer")
    }
  }

  if (isInitialLoading) {
    return <LoadingSkeleton />
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
                <PlusCircle className="h-4 w-4" />
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
                    <Select value={field.value} onValueChange={field.onChange}>
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

              {injectionForm.watch("toLocation") === "bank" && (
                <BankAccountSelect
                  name="toSubLocationId"
                  control={injectionForm.control}
                  label="Bank Account"
                  bankAccountBalances={bankAccountBalances}
                />
              )}

              <MoneyInput
                name="amount"
                control={injectionForm.control}
                label="Amount (UGX)"
                required="Amount is required"
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
                      maxLength={2500}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <Button type="submit" className="w-full">
                Record Injection
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button>
                <ArrowRightLeft className="h-4 w-4" />
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
                    <Select value={field.value} onValueChange={field.onChange}>
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

              {fromLocation === "bank" && (
                <BankAccountSelect
                  name="fromSubLocationId"
                  control={control}
                  label="From Bank Account"
                  bankAccountBalances={bankAccountBalances}
                />
              )}

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
                    <Select value={field.value} onValueChange={field.onChange}>
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

              {watch("toLocation") === "bank" && (
                <BankAccountSelect
                  name="toSubLocationId"
                  control={control}
                  label="To Bank Account"
                  bankAccountBalances={bankAccountBalances}
                />
              )}

              <MoneyInput
                name="amount"
                control={control}
                label="Amount (UGX)"
                required="Amount is required"
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
                      maxLength={2500}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <Button type="submit" className="w-full">
                Record Transfer
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Bank Accounts section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="h-4 w-4" />
            Bank Accounts
          </CardTitle>
          {isAdmin && (
            <Dialog open={bankAccountDialogOpen} onOpenChange={setBankAccountDialogOpen}>
              <DialogTrigger
                render={
                  <Button size="sm" variant="outline">
                    <PlusCircle className="h-3.5 w-3.5" />
                    New Account
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Bank Account</DialogTitle>
                </DialogHeader>
                <form onSubmit={bankAccountForm.handleSubmit(onCreateBankAccount)} className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="bankAccountName">Account Name</Label>
                    <Controller
                      name="name"
                      control={bankAccountForm.control}
                      rules={{ required: "Account name is required" }}
                      render={({ field, fieldState }) => (
                        <>
                          <Input
                            id="bankAccountName"
                            placeholder="e.g. Stanbic Business Account"
                            {...field}
                          />
                          {fieldState.error?.message && (
                            <p className="text-sm text-destructive">{fieldState.error.message}</p>
                          )}
                        </>
                      )}
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Create Account
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {bankAccountsList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm px-4">
              No bank accounts configured yet. Create one to start tracking per-account balances.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankAccountsList.map((account) => {
                  const balance = bankAccountBalances[account.id]
                  return (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {balance != null ? formatCurrency(balance) : "—"}
                      </TableCell>
                      <TableCell>
                        {account.isActive ? (
                          <Badge variant="outline" className="rounded-full bg-emerald-50 text-emerald-700 border-emerald-200">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-full bg-muted text-muted-foreground">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label="Account actions"
                              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted transition-colors"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  const newName = prompt("New account name:", account.name)
                                  if (newName && newName.trim() && newName.trim() !== account.name) {
                                    bankAccountCollection.update(account.id, (draft) => {
                                      draft.name = newName.trim()
                                    })
                                    toast.success("Account renamed")
                                  }
                                }}
                              >
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  const nextActive = !account.isActive
                                  bankAccountCollection.update(account.id, (draft) => {
                                    draft.isActive = nextActive
                                  })
                                  toast.success(nextActive ? "Account reactivated" : "Account deactivated")
                                }}
                              >
                                {account.isActive ? "Deactivate" : "Reactivate"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {transfers.length === 0 ? (
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

export default function FundTransfersPage() {
  const { data: session } = useSession()
  const { has } = usePermissions()
  const isAdmin = has("fund-transfer:create")

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

  return <FundTransfersContent session={session} />
}
