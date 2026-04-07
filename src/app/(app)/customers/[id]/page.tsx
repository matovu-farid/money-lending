"use client";

import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  updateCustomerAction,
  changeCustomerStatusAction,
} from "@/actions/customer.actions";
import { getCustomerLoansWithOverdueAction } from "@/actions/loan.actions";
import { getPaymentPortionsAction } from "@/actions/payment.actions";
import { useCustomer } from "@/hooks/use-customer";
import { useLoanPayments } from "@/hooks/use-payments";
import { queryKeys } from "@/hooks/query-keys";
import { OverdueBadge } from "@/components/watchlist/overdue-badge";
import type { Customer, Loan, CustomerStatus, PaymentPortionsMap } from "@/types";
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
import { InfoPopover } from "@/components/ui/info-popover";
import { PageHeader } from "@/components/ui/page-header";
import { cn, formatDate, formatCurrency, formatRate } from "@/lib/utils";
import { customerStatusVariant, customerStatusLabel, loanStatusVariant, loanStatusLabel } from "@/lib/status";
import { LoanTypeBadge } from "@/components/loans/loan-type-badge";

interface LoanWithOverdue {
  loan: Loan;
  daysOverdue: number;
}

function CustomerLoanCard({ item }: { item: LoanWithOverdue }) {
  const [expanded, setExpanded] = useState(false);
  const { data: payments, isLoading: loadingPayments } = useLoanPayments(
    item.loan.id,
    expanded,
  );

  const activePaymentIds = payments?.filter((p) => p.deletedAt === null).map((p) => p.id) ?? [];
  const { data: portionsData } = useQuery<PaymentPortionsMap>({
    queryKey: [...queryKeys.payments.portions(item.loan.id), activePaymentIds.join(",")],
    queryFn: async () => {
      if (activePaymentIds.length === 0) return {};
      const result = await getPaymentPortionsAction(activePaymentIds);
      if ("error" in result) return {};
      return result.data;
    },
    enabled: expanded && activePaymentIds.length > 0,
  });

  return (
    <Card>
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
              <LoanTypeBadge loanType={item.loan.loanType} />
              {item.loan.status === "active" &&
                item.daysOverdue > 0 && (
                  <OverdueBadge daysOverdue={item.daysOverdue} />
                )}
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              Issued {formatDate(item.loan.startDate)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
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
              {formatRate(item.loan.interestRate)}
            </span>{" "}
            per month
          </p>
        </div>

        {expanded && (
          <div className="mt-4">
            {loadingPayments ? (
              <p className="text-sm text-muted-foreground">
                Loading payments...
              </p>
            ) : !payments || payments.length === 0 ? (
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
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
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
                          {formatCurrency(portionsData?.[payment.id]?.interestPortion ?? "0.00")}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono tabular-nums",
                            payment.deletedAt &&
                              "line-through text-muted-foreground",
                          )}
                        >
                          {formatCurrency(portionsData?.[payment.id]?.principalPortion ?? "0.00")}
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
  );
}

interface EditFormValues {
  fullName: string;
  nin: string;
  contact: string;
  address: string;
}

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customerId = params.id as string;

  const {
    data: customer,
    isLoading: customerLoading,
    isError: notFound,
  } = useCustomer(customerId);

  const { data: loanItems = [], isLoading: loansLoading } = useQuery<
    LoanWithOverdue[]
  >({
    queryKey: queryKeys.loans.byCustomer(customerId),
    queryFn: async () => {
      const result = await getCustomerLoansWithOverdueAction(customerId);
      if (!("data" in result) || !result.data) return [];
      return result.data.map((item) => ({
        loan: item,
        daysOverdue: item.daysOverdue,
      }));
    },
  });

  const loading = customerLoading || loansLoading;

  const [editing, setEditing] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditFormValues>();
  const [isEditPending, startEditTransition] = useTransition();

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
      nin: customer.nin,
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
      const detailKey = queryKeys.customers.detail(customerId);
      const previous = queryClient.getQueryData<Customer>(detailKey);

      queryClient.setQueryData<Customer>(detailKey, (old) =>
        old
          ? {
              ...old,
              fullName: data.fullName.trim(),
              nin: data.nin.trim(),
              contact: data.contact.trim(),
              address: data.address.trim(),
            }
          : old,
      );

      const result = await updateCustomerAction(customerId, {
        fullName: data.fullName.trim(),
        nin: data.nin.trim(),
        contact: data.contact.trim(),
        address: data.address.trim(),
      });

      if ("error" in result) {
        queryClient.setQueryData(detailKey, previous);
        toast.error(result.error);
        return;
      }

      queryClient.setQueryData(detailKey, result.data);
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
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
      const detailKey = queryKeys.customers.detail(customerId);
      const previous = queryClient.getQueryData<Customer>(detailKey);

      queryClient.setQueryData<Customer>(detailKey, (old) =>
        old ? { ...old, status: pendingStatus } : old,
      );

      const result = await changeCustomerStatusAction({
        customerId: customer.id,
        newStatus: pendingStatus,
        reason: statusReason,
      });
      if ("error" in result) {
        queryClient.setQueryData(detailKey, previous);
        toast.error(result.error);
        return;
      }
      queryClient.setQueryData(detailKey, result.data);
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      setStatusDialogOpen(false);
      toast.success(
        `${customer.fullName}'s status updated to ${customerStatusLabel(pendingStatus)}.`,
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
    : `Change status to ${pendingStatus ? customerStatusLabel(pendingStatus) : ""}?`;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <PageHeader title={customer.fullName} subtitle="Customer profile">
        <Link
          href={`/loans/new?customerId=${customerId}`}
          className={cn(buttonVariants())}
        >
          Issue New Loan
        </Link>
      </PageHeader>

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
                  <p className="text-sm text-destructive">
                    {errors.fullName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-nin">NIN (National ID Number)</Label>
                <Input
                  id="edit-nin"
                  {...register("nin", {
                    required: "NIN is required",
                    validate: (v) =>
                      v.trim() !== "" || "NIN is required",
                  })}
                  disabled={isEditPending}
                />
                {errors.nin && (
                  <p className="text-sm text-destructive">
                    {errors.nin.message}
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
                  <p className="text-sm text-destructive">
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
                  <p className="text-sm text-destructive">
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
                <dt className="text-muted-foreground">NIN (National ID Number)</dt>
                <dd className="font-medium">{customer.nin}</dd>
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

      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1">
            Status
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Customer Status</p>
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p><strong>Active</strong> — Customer can receive new loans and make payments.</p>
                <p><strong>Blacklisted</strong> — Customer is blocked from receiving new loans. Existing active loans continue to accrue interest and accept payments.</p>
                <p><strong>Inactive</strong> — Customer is no longer active but not blacklisted. Typically used for customers who have fully paid all loans.</p>
              </div>
            </InfoPopover>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={customer.status} onValueChange={handleStatusSelect}>
            <SelectTrigger className="w-[200px]">
              <SelectValue>{customerStatusLabel(customer.status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

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
                <p className="text-sm text-destructive">
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

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Loan History</h2>

        {loanItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No loans on record for this customer.
          </p>
        ) : (
          loanItems.map((item) => (
            <CustomerLoanCard key={item.loan.id} item={item} />
          ))
        )}
      </div>
    </div>
  );
}
