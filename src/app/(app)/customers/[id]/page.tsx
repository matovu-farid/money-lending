"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLiveSuspenseQuery, useLiveQuery, eq } from "@tanstack/react-db";
import { customerCollection, loanCollection, paymentCollection, getPaymentPortionsCollection } from "@/collections";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";
import { Banknote, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  changeCustomerStatusAction,
} from "@/actions/customer.actions";
import { OverdueBadge } from "@/components/watchlist/overdue-badge";
import { getBaseRate } from "@/lib/interest/effective-rate";
import type { Loan, CustomerStatus, PaymentPortionsMap } from "@/types";
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
import { customerStatusLabel, loanStatusVariant, loanStatusLabel } from "@/lib/status";
import { LoanTypeBadge } from "@/components/loans/loan-type-badge";
import { PaymentReceiptButton } from "@/components/receipts/payment-receipt-button";
import { DisbursementReceiptButton } from "@/components/receipts/disbursement-receipt-button";

interface LoanWithOverdue {
  loan: Loan;
  daysOverdue: number;
}


function CustomerLoanCard({ item, customerName }: { item: LoanWithOverdue; customerName: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data: rawPayments } = useLiveSuspenseQuery(
    (q) => q.from({ p: paymentCollection }).where(({ p }) => eq(p.loanId, item.loan.id)),
    [item.loan.id]
  );
  const payments = Array.isArray(rawPayments) ? rawPayments : [];

  const activePaymentIds = payments.map((p) => p.id);
  const portionsColl = expanded ? getPaymentPortionsCollection(item.loan.id, activePaymentIds) : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadingPayments = false
  const { data: portionsRows } = useLiveQuery(((q: any) =>
    portionsColl
      ? q.from({ pp: portionsColl }).select(({ pp }: any) => pp)
      : undefined
  ) as any, [activePaymentIds.join(","), expanded]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const portionsData: PaymentPortionsMap = (portionsRows as any)?.[0]?.portions ?? {};

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/loans/${item.loan.id}`}
                className="text-sm font-mono text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                LOAN-{shortId(item.loan.id).toUpperCase()}
              </Link>
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
              {formatRate(getBaseRate(item.loan))}
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
            ) : payments.length === 0 ? (
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
                      >
                        <TableCell>
                          {formatDate(payment.paymentDate)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(portionsData?.[payment.id]?.interestPortion ?? "0.00")}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(portionsData?.[payment.id]?.principalPortion ?? "0.00")}
                        </TableCell>
                        <TableCell>
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

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-7 w-48 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-4 w-28 rounded bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
      <div className="border rounded-lg px-4 py-3 space-y-3">
        <div className="h-5 w-36 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
          ))}
        </div>
      </div>
      <div className="border rounded-lg p-6 space-y-2">
        <div className="h-5 w-16 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="h-9 w-[200px] rounded-md bg-muted-foreground/10 animate-pulse" />
      </div>
    </div>
  )
}

function CustomerProfileContent({ customerId }: { customerId: string }) {
  const router = useRouter();

  // Read customer from customerCollection
  const { data: customersData } = useLiveSuspenseQuery(
    (q) => q.from({ c: customerCollection }).where(({ c }) => eq(c.id, customerId)),
    [customerId]
  );
  const customer = customersData?.[0] ?? null;
  const notFound = !customer;

  // Read loans from loanCollection, filtered by customer
  const { data: customerLoans } = useLiveSuspenseQuery(
    (q) => q.from({ loan: loanCollection }).where(({ loan }) => eq(loan.customerId, customerId)),
    [customerId]
  );
  const loanItems: LoanWithOverdue[] = (customerLoans ?? []).map((entry) => ({
    loan: entry as unknown as Loan,
    daysOverdue: entry.daysOverdue,
  }));

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
  }, [activeLoan, router]);

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
      try {
        customerCollection.update(customerId, (draft) => {
          draft.fullName = data.fullName.trim();
          draft.nin = data.nin.trim();
          draft.contact = data.contact.trim();
          draft.address = data.address.trim();
        });
        setEditing(false);
        toast.success("Customer updated successfully");
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to update customer");
      }
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
      // Status changes go through the server action (audit trail + reason)
      const result = await changeCustomerStatusAction({
        customerId: customer.id,
        newStatus: pendingStatus,
        reason: statusReason,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Update collection optimistically to reflect new status
      customerCollection.update(customerId, (draft) => {
        draft.status = pendingStatus;
      });
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

        {loanItems.length === 0 ? (
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

export default function CustomerProfilePage() {
  const params = useParams();
  const customerId = params.id as string;

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <CustomerProfileContent customerId={customerId} />
    </Suspense>
  );
}
