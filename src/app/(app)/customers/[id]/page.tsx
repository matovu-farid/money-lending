"use client";

import { useState, useCallback, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  getCustomerAction,
  updateCustomerAction,
  changeCustomerStatusAction,
} from "@/actions/customer.actions";
import { listLoansAction } from "@/actions/loan.actions";
import { getPaymentsByLoanAction } from "@/actions/payment.actions";
import { OverdueBadge } from "@/components/watchlist/overdue-badge";
import {
  calculateDaysOverdue,
  calculateDailyRate,
  calculateInterest,
} from "@/lib/interest";
import BigNumber from "bignumber.js";
import type { Customer, Loan, Payment, CustomerStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DrawerDialog,
  DrawerDialogContent,
} from "@/components/ui/drawer-dialog";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate, formatCurrency } from "@/lib/utils";

function statusVariant(
  status: string,
): "default" | "destructive" | "secondary" {
  if (status === "active") return "default";
  if (status === "blacklisted") return "destructive";
  return "secondary";
}

function statusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "blacklisted") return "Blacklisted";
  return "Inactive";
}

function loanStatusVariant(status: string): "default" | "outline" {
  if (status === "active") return "default";
  return "outline";
}

function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface LoanWithPayments {
  loan: Loan;
  payments: Payment[];
  expanded: boolean;
  loadingPayments: boolean;
  daysOverdue: number;
}

type LoanUIOverride = Pick<
  LoanWithPayments,
  "payments" | "expanded" | "loadingPayments"
> & { daysOverdue?: number };

interface EditFormValues {
  fullName: string;
  contact: string;
  address: string;
}

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customerId = params.id as string;

  // Fetch customer via useQuery — cached for 60s (provider staleTime),
  // so navigating away (e.g. /loans/new) and back serves from cache instantly.
  const {
    data: customer,
    isLoading: customerLoading,
    isError: notFound,
  } = useQuery<Customer>({
    queryKey: ["customer", customerId],
    queryFn: async () => {
      const result = await getCustomerAction(customerId);
      if ("error" in result) throw new Error(result.error);
      return result.data;
    },
  });

  // Fetch this customer's loans via useQuery
  const { data: fetchedLoanItems, isLoading: loansLoading } = useQuery<
    LoanWithPayments[]
  >({
    queryKey: ["customer-loans", customerId],
    queryFn: async () => {
      const loansResult = await listLoansAction();
      if (!("data" in loansResult) || !loansResult.data) return [];
      const customerLoans = loansResult.data.filter(
        (l) => l.customerId === customerId,
      );
      const now = new Date();
      return customerLoans.map((loan) => {
        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate;
        const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays;
        const totalInterestAccrued = calculateInterest(
          loan.principalAmount,
          effectiveRate,
          totalDaysElapsed,
          effectiveMinDays,
        );
        const dailyRate = calculateDailyRate(effectiveRate);
        const daysOverdueBN = calculateDaysOverdue(
          totalInterestAccrued.toFixed(2),
          "0",
          dailyRate.toFixed(10),
        );
        return {
          loan,
          payments: [],
          expanded: false,
          loadingPayments: false,
          daysOverdue: loan.status === "active" ? daysOverdueBN.toNumber() : 0,
        };
      });
    },
  });

  // UI-only overrides (expanded, payments, loadingPayments) keyed by loan id
  const [uiOverrides, setUiOverrides] = useState<Map<string, LoanUIOverride>>(
    new Map(),
  );

  // Derive loanItems by merging query data with UI overrides
  const loanItems = fetchedLoanItems
    ? fetchedLoanItems.map((item) => {
        const override = uiOverrides.get(item.loan.id);
        return override ? { ...item, ...override } : item;
      })
    : [];

  // Helper to update UI overrides for a specific loan
  const updateLoanItem = useCallback(
    (
      index: number,
      updater: (item: LoanWithPayments) => Partial<LoanWithPayments>,
    ) => {
      if (!fetchedLoanItems) return;
      const base = fetchedLoanItems[index];
      if (!base) return;
      setUiOverrides((prev) => {
        const next = new Map(prev);
        const current = next.get(base.loan.id) ?? {
          payments: base.payments,
          expanded: base.expanded,
          loadingPayments: base.loadingPayments,
          daysOverdue: base.daysOverdue,
        };
        const merged = {
          ...current,
          ...updater({ ...base, ...current }),
        } as LoanUIOverride;
        next.set(base.loan.id, merged);
        return next;
      });
    },
    [fetchedLoanItems],
  );

  const loading = customerLoading || loansLoading;

  // Edit state — react-hook-form
  const [editing, setEditing] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditFormValues>();
  const [isEditPending, startEditTransition] = useTransition();

  // Status change state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<CustomerStatus | null>(
    null,
  );
  const [statusReason, setStatusReason] = useState("");
  const [isStatusPending, startStatusTransition] = useTransition();

  function handleEditStart() {
    if (!customer) return;
    reset({
      fullName: customer.fullName,
      contact: customer.contact,
      address: customer.address,
    });
    setEditing(true);
  }

  function handleEditCancel() {
    setEditing(false);
  }

  function onEditSubmit(data: EditFormValues) {
    if (!customer) return;
    startEditTransition(async () => {
      const result = await updateCustomerAction(customerId, {
        fullName: data.fullName.trim() || undefined,
        contact: data.contact.trim() || undefined,
        address: data.address.trim() || undefined,
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      queryClient.setQueryData(["customer", customerId], result.data);
      setEditing(false);
      toast.success("Customer updated successfully");
    });
  }

  function handleStatusSelect(newStatus: string | null) {
    if (!newStatus || !customer) return;
    if (newStatus === customer.status) return;
    setPendingStatus(newStatus as CustomerStatus);
    setStatusReason("");
    setStatusDialogOpen(true);
  }

  function handleStatusConfirm() {
    if (!customer || !pendingStatus || statusReason.trim().length < 10) return;
    startStatusTransition(async () => {
      const result = await changeCustomerStatusAction({
        customerId: customer.id,
        newStatus: pendingStatus,
        reason: statusReason,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      queryClient.setQueryData(["customer", customerId], result.data);
      setStatusDialogOpen(false);
      toast.success(
        `${customer.fullName}'s status updated to ${statusLabel(pendingStatus)}.`,
      );
      setPendingStatus(null);
      setStatusReason("");
    });
  }

  function handleStatusCancel() {
    setStatusDialogOpen(false);
    setPendingStatus(null);
    setStatusReason("");
  }

  async function handleToggleLoan(index: number) {
    const item = loanItems[index];
    if (!item) return;

    if (item.expanded) {
      updateLoanItem(index, () => ({ expanded: false }));
      return;
    }

    if (item.payments.length === 0) {
      updateLoanItem(index, () => ({ loadingPayments: true, expanded: true }));

      const result = await getPaymentsByLoanAction(item.loan.id);
      if ("data" in result && result.data) {
        const fetchedPayments = result.data;
        const now = new Date();
        const loan = item.loan;
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate;
        const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays;
        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        const totalInterestAccrued = calculateInterest(
          loan.principalAmount,
          effectiveRate,
          totalDaysElapsed,
          effectiveMinDays,
        );
        const activePayments = fetchedPayments.filter((p) => !p.deletedAt);
        const totalInterestPaid = activePayments.reduce(
          (s, p) => s.plus(new BigNumber(p.interestPortion)),
          new BigNumber(0),
        );
        const dailyRate = calculateDailyRate(effectiveRate);
        const daysOverdueBN = calculateDaysOverdue(
          totalInterestAccrued.toFixed(2),
          totalInterestPaid.toFixed(2),
          dailyRate.toFixed(10),
        );

        updateLoanItem(index, () => ({
          payments: fetchedPayments,
          loadingPayments: false,
          daysOverdue: loan.status === "active" ? daysOverdueBN.toNumber() : 0,
        }));
      } else {
        updateLoanItem(index, () => ({ loadingPayments: false }));
      }
    } else {
      updateLoanItem(index, () => ({ expanded: true }));
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-32 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
          <div className="h-24 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFound || !customer) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <p className="text-destructive">Customer not found.</p>
        <Button variant="outline" onClick={() => router.push("/customers")}>
          Back to Customers
        </Button>
      </div>
    );
  }

  const isBlacklisted = pendingStatus === "blacklisted";
  const dialogTitle = isBlacklisted
    ? `Blacklist ${customer.fullName}?`
    : `Change status to ${pendingStatus ? statusLabel(pendingStatus) : ""}?`;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {customer.fullName}
          </h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
            Customer profile
          </p>
        </div>
        <Link
          href={`/loans/new?customerId=${customerId}`}
          className={cn(buttonVariants())}
        >
          Issue New Loan
        </Link>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Basic Information</CardTitle>
            {!editing && (
              <Button variant="outline" size="sm" onClick={handleEditStart}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <form onSubmit={handleSubmit(onEditSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="edit-fullName">Full Name</Label>
                <Input
                  id="edit-fullName"
                  {...register("fullName", {
                    required: "Full name is required",
                    minLength: {
                      value: 2,
                      message: "Full name must be at least 2 characters",
                    },
                  })}
                  disabled={isEditPending}
                />
                {errors.fullName && (
                  <p className="text-xs text-destructive">
                    {errors.fullName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-contact">Contact</Label>
                <Input
                  id="edit-contact"
                  {...register("contact", {
                    required: "Contact is required",
                  })}
                  disabled={isEditPending}
                />
                {errors.contact && (
                  <p className="text-xs text-destructive">
                    {errors.contact.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-address">Physical Address</Label>
                <Input
                  id="edit-address"
                  {...register("address", {
                    required: "Address is required",
                  })}
                  disabled={isEditPending}
                />
                {errors.address && (
                  <p className="text-xs text-destructive">
                    {errors.address.message}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={isEditPending}>
                  {isEditPending ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleEditCancel}
                  disabled={isEditPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Full Name</dt>
                <dd className="font-medium">{customer.fullName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contact</dt>
                <dd className="font-medium">{customer.contact}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Physical Address</dt>
                <dd className="font-medium">{customer.address}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Status — interactive dropdown */}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={customer.status} onValueChange={handleStatusSelect}>
            <SelectTrigger className="w-[200px]">
              <SelectValue>{statusLabel(customer.status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Status change confirmation dialog */}
      <DrawerDialog
        open={statusDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleStatusCancel();
        }}
      >
        <DrawerDialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle
              className={isBlacklisted ? "text-destructive" : undefined}
            >
              {dialogTitle}
            </DialogTitle>
            {isBlacklisted && (
              <DialogDescription>
                This will prevent {customer.fullName} from receiving new loans.
                Active loans will continue. Provide a reason.
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="status-reason">Reason (min 10 characters)</Label>
            <Textarea
              id="status-reason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Provide a reason for this status change..."
              disabled={isStatusPending}
            />
            {statusReason.trim().length > 0 &&
              statusReason.trim().length < 10 && (
                <p className="text-xs text-destructive">
                  Reason must be at least 10 characters
                </p>
              )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleStatusCancel}
              disabled={isStatusPending}
            >
              Cancel
            </Button>
            <Button
              variant={isBlacklisted ? "destructive" : "default"}
              onClick={handleStatusConfirm}
              disabled={isStatusPending || statusReason.trim().length < 10}
            >
              {isStatusPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Saving...
                </>
              ) : (
                "Confirm"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Loan History */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Loan History</h2>

        {loanItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No loans on record for this customer.
          </p>
        ) : (
          loanItems.map((item, index) => (
            <Card key={item.loan.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-muted-foreground">
                        LOAN-{item.loan.id.slice(0, 8).toUpperCase()}
                      </span>
                      <Badge variant={loanStatusVariant(item.loan.status)}>
                        {loanStatusLabel(item.loan.status)}
                      </Badge>
                      {item.loan.status === "active" &&
                        item.daysOverdue > 0 && (
                          <OverdueBadge
                            daysOverdue={Math.round(item.daysOverdue)}
                          />
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      Issued {formatDate(item.loan.startDate)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleLoan(index)}
                    aria-label={item.expanded ? "Collapse" : "Expand"}
                  >
                    {item.expanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <p className="text-2xl font-semibold font-mono tracking-tight tabular-nums">
                    {formatCurrency(item.loan.principalAmount)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {(parseFloat(item.loan.interestRate) * 100).toFixed(0)}%
                    </span>{" "}
                    per month
                  </p>
                </div>

                {item.expanded && (
                  <div className="mt-4">
                    {item.loadingPayments ? (
                      <p className="text-sm text-muted-foreground">
                        Loading payments...
                      </p>
                    ) : item.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No payments recorded.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead className="text-right">
                                Interest
                              </TableHead>
                              <TableHead className="text-right">
                                Principal
                              </TableHead>
                              <TableHead className="text-right">
                                Balance After
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {item.payments.map((payment) => (
                              <TableRow
                                key={payment.id}
                                data-testid="data-row"
                                className={cn(payment.deletedAt && "opacity-60")}
                              >
                                <TableCell
                                  className={cn(
                                    payment.deletedAt &&
                                      "line-through text-muted-foreground",
                                  )}
                                >
                                  {formatDate(payment.paymentDate)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono tabular-nums",
                                    payment.deletedAt &&
                                      "line-through text-muted-foreground",
                                  )}
                                >
                                  {formatCurrency(payment.amount)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono tabular-nums",
                                    payment.deletedAt &&
                                      "line-through text-muted-foreground",
                                  )}
                                >
                                  {formatCurrency(payment.interestPortion)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono tabular-nums",
                                    payment.deletedAt &&
                                      "line-through text-muted-foreground",
                                  )}
                                >
                                  {formatCurrency(payment.principalPortion)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono tabular-nums",
                                    payment.deletedAt &&
                                      "line-through text-muted-foreground",
                                  )}
                                >
                                  {formatCurrency(payment.principalBalanceAfter)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
