"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";
import { Banknote, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  updateCustomerAction,
  changeCustomerStatusAction,
} from "@/actions/customer.actions";
import { getCustomerLoansWithOverdueAction, getLoanPaymentContextAction } from "@/actions/loan.actions";
import { getPaymentPortionsAction, getLoanBalanceAction } from "@/actions/payment.actions";
import { useCustomer } from "@/hooks/use-customer";
import { useLoanPayments } from "@/hooks/use-payments";
import { queryKeys } from "@/hooks/query-keys";
import { OverdueBadge } from "@/components/watchlist/overdue-badge";
import type { Customer, Loan, CustomerStatus, PaymentPortionsMap } from "@/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerFormFields, type CustomerFormValues } from "@/components/customers/customer-form-fields";
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
import { cn, formatDate, formatCurrency, formatRate, shortId } from "@/lib/utils";
import { customerStatusVariant, customerStatusLabel, loanStatusVariant, loanStatusLabel } from "@/lib/status";
import { LoanTypeBadge } from "@/components/loans/loan-type-badge";
import { PaymentReceiptButton } from "@/components/receipts/payment-receipt-button";
import { DisbursementReceiptButton } from "@/components/receipts/disbursement-receipt-button";

interface LoanWithOverdue {
  loan: Loan;
  daysOverdue: number;
}


function CustomerLoanCard({ item, customerName }: { item: LoanWithOverdue; customerName: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data: payments, isLoading: loadingPayments } = useLoanPayments(
    item.loan.id,
    expanded,
  );

  const activePaymentIds = (Array.isArray(payments) ? payments : []).filter((p) => p.deletedAt === null).map((p) => p.id);
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
    <>
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-mono text-muted-foreground">
                LOAN-{shortId(item.loan.id).toUpperCase()}
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
          <div className="flex items-center gap-1">
            <DisbursementReceiptButton loanId={item.loan.id} />
            <Link
              href={`/receipts/disbursement/${item.loan.id}`}
              target="_blank"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              aria-label="Full disbursement receipt"
            >
              <ChevronUp className="h-4 w-4 rotate-90" />
            </Link>
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
                      <TableHead className="w-10"></TableHead>
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
                        <TableCell>
                          {!payment.deletedAt && (
                            <PaymentReceiptButton
                              data={{
                                paymentDate: payment.paymentDate,
                                customerName,
                                loanReference: `LOAN-${shortId(item.loan.id).toUpperCase()}`,
                                amountPaid: payment.amount,
                                interestPortion: portionsData?.[payment.id]?.interestPortion ?? "0.00",
                                principalPortion: portionsData?.[payment.id]?.principalPortion ?? "0.00",
                                balanceAfter: "0.00",
                                depositLocation: payment.depositLocation,
                                officerName: "Officer",
                              }}
                            />
                          )}
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
    </>
  );
}

type EditFormValues = CustomerFormValues;

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

  const { data: rawLoanItems, isLoading: loansLoading } = useQuery<
    LoanWithOverdue[]
  >({
    queryKey: queryKeys.loans.byCustomer(customerId),
    queryFn: async () => {
      const result = await getCustomerLoansWithOverdueAction(customerId);
      if (!("data" in result) || !result.data) return [];
      return result.data.map((item: any) => ({
        loan: item,
        daysOverdue: item.daysOverdue,
      }));
    },
  });
  const loanItems = Array.isArray(rawLoanItems) ? rawLoanItems : [];

  const [editing, setEditing] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<EditFormValues>();
  const [isEditPending, startEditTransition] = useTransition();

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<CustomerStatus | null>(
    null,
  );
  const [statusReason, setStatusReason] = useState("");
  const [isStatusPending, startStatusTransition] = useTransition();

  const activeLoan = loanItems.find((item) => item.loan.status === "active");

  useEffect(() => {
    if (!activeLoan) return;
    const loanId = activeLoan.loan.id;
    router.prefetch(`/loans/${loanId}/payments/new`);
    queryClient.prefetchQuery({
      queryKey: queryKeys.loans.paymentContext(loanId),
      queryFn: () => getLoanPaymentContextAction(loanId).then((r) => ("error" in r ? undefined : r.data)),
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.loans.balance(loanId),
      queryFn: () => getLoanBalanceAction(loanId).then((r) => ("error" in r ? undefined : r.data)),
    });
  }, [activeLoan, router, queryClient]);

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

  if (customerLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-2xl">
        {/* Page header skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-7 w-48 rounded bg-muted-foreground/10 animate-pulse" />
            <div className="h-4 w-28 rounded bg-muted-foreground/10 animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-32 rounded-md bg-muted-foreground/10 animate-pulse" />
            <div className="h-9 w-32 rounded-md bg-muted-foreground/10 animate-pulse" />
          </div>
        </div>
        {/* Basic info accordion skeleton */}
        <div className="border rounded-lg px-4 py-3 space-y-3">
          <div className="h-5 w-36 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
            <div className="h-4 w-40 rounded bg-muted-foreground/10 animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
          </div>
        </div>
        {/* Status card skeleton */}
        <div className="border rounded-lg p-6 space-y-2">
          <div className="h-5 w-16 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-9 w-[200px] rounded-md bg-muted-foreground/10 animate-pulse" />
        </div>
        {/* Loan history skeleton */}
        <div className="space-y-4">
          <div className="h-6 w-28 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="border rounded-lg p-6 space-y-3">
            <div className="flex justify-between">
              <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-muted-foreground/10 animate-pulse" />
            </div>
            <div className="h-8 w-28 rounded bg-muted-foreground/10 animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <p className="text-destructive">Customer not found.</p>
        <Button variant="outline" onClick={() => router.push("/customers")}>
          Back to Customers
        </Button>
      </div>
    );
  }

  if (!customer) {
    // Initial render before query starts (prevents hydration mismatch)
    return null;
  }

  const isBlacklisted = pendingStatus === "blacklisted";
  const dialogTitle = isBlacklisted
    ? `Blacklist ${customer.fullName}?`
    : `Change status to ${pendingStatus ? customerStatusLabel(pendingStatus) : ""}?`;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <PageHeader title={customer.fullName} subtitle="Customer profile">
        {activeLoan && (
          <Link
            href={`/loans/${activeLoan.loan.id}/payments/new`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Banknote className="h-4 w-4 mr-1.5" />
            Record Payment
          </Link>
        )}
        <Link
          href={`/loans/new?customerId=${customerId}`}
          className={cn(buttonVariants())}
        >
          Issue New Loan
        </Link>
      </PageHeader>

      {/* @ts-expect-error -- Accordion value type mismatch with radix/shadcn generics */}
      <Accordion type="single" collapsible defaultValue={editing ? "basic-info" : undefined} value={editing ? "basic-info" : undefined}>
        <AccordionItem value="basic-info" className="border rounded-lg px-4">
          <div className="flex items-center justify-between">
            <AccordionTrigger className="flex-1 text-base font-semibold">
              Basic Information
            </AccordionTrigger>
            {!editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditStart();
                }}
              >
                Edit
              </Button>
            )}
          </div>
          <AccordionContent>
            {editing ? (
              <form onSubmit={handleSubmit(onEditSubmit)} className="space-y-4 pt-2">
                <CustomerFormFields
                  register={register}
                  setValue={setValue}
                  errors={errors}
                  disabled={isEditPending}
                  idPrefix="edit"
                />
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
              <dl className="space-y-3 text-sm pt-2">
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1">
            Status
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Customer Status</p>
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p><strong>Active</strong> — Customer can receive new loans and make payments.</p>
                <p><strong>Blacklisted</strong> — Customer is blocked from receiving new loans. Existing active loans continue to accrue interest and accept payments.</p>

              </div>
            </InfoPopover>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={customer.status ?? "active"} onValueChange={handleStatusSelect}>
            <SelectTrigger className="w-[200px]">
              <SelectValue>{customerStatusLabel(customer.status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>

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
              maxLength={2500}
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

        {loansLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="border rounded-lg p-6 space-y-3">
                <div className="flex justify-between">
                  <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
                  <div className="h-5 w-16 rounded-full bg-muted-foreground/10 animate-pulse" />
                </div>
                <div className="h-8 w-28 rounded bg-muted-foreground/10 animate-pulse" />
                <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
              </div>
            ))}
          </div>
        ) : loanItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No loans on record for this customer.
          </p>
        ) : (
          loanItems.map((item) => (
            <CustomerLoanCard key={item.loan.id} item={item} customerName={customer.fullName} />
          ))
        )}
      </div>
    </div>
  );
}
