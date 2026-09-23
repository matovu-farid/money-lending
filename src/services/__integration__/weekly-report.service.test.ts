import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { testDb, resetDb, seedCategories } from "./setup";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { getWeeklyLoansData, getWeeklyPaymentsData } from "@/services/weekly-report.service";
import { createCustomer } from "@/services/customer.service";
import { createLoan, listLoanBalances } from "@/services/loan.service";
import { listPayments, recordPayment } from "@/services/payment.service";
import { getPaymentPortionsFromLedger } from "@/services/ledger-queries.service";
import { createCapitalInjection } from "@/services/fund-transfer.service";
import BigNumber from "bignumber.js";

const WEEK = "2026-09-21";
const START = new Date("2026-09-20T21:00:00.000Z");
const END = new Date("2026-09-27T21:00:00.000Z");

describe("Weekly report service — PostgreSQL integration", { timeout: 30_000, sequential: true }, () => {
  beforeEach(async () => {
    await resetDb();
    await seedCategories();
  });

  it("uses half-open bounds and payment exclusions with exact totals", async () => {
    const [customer] = await testDb.insert(customers).values({
      fullName: "Weekly Report Customer", nin: "WEEKLY-REPORT-1", contact: "+256700000991", address: "Kampala",
    }).returning({ id: customers.id });
    const [loan] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "500.00", issuanceFee: "0.00", interestRate: "0.1000",
      startDate: new Date("2026-09-21T00:00:00.000Z"), issuedBy: "integration-test-actor", disbursementSource: "cash",
    }).returning({ id: loans.id });
    const [deletedLoan] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "500.00", issuanceFee: "0.00", interestRate: "0.1000",
      startDate: new Date("2026-09-21T00:00:00.000Z"), issuedBy: "integration-test-actor", disbursementSource: "cash",
      deletedAt: new Date(),
    }).returning({ id: loans.id });
    const [pendingLoan] = await testDb.insert(loans).values({
      customerId: customer.id, principalAmount: "500.00", issuanceFee: "0.00", interestRate: "0.1000",
      startDate: new Date("2026-09-21T00:00:00.000Z"), issuedBy: "integration-test-actor", disbursementSource: "cash",
      status: "pending",
    }).returning({ id: loans.id });
    const paymentRows = [
      { id: "10000000-0000-4000-8000-000000000001", paymentDate: new Date(START.getTime() - 1), amount: "99.00" },
      { id: "10000000-0000-4000-8000-000000000002", paymentDate: START, amount: "0.10" },
      { id: "10000000-0000-4000-8000-000000000007", paymentDate: START, amount: "0.05" },
      { id: "10000000-0000-4000-8000-000000000003", paymentDate: new Date(END.getTime() - 1), amount: "0.20" },
      { id: "10000000-0000-4000-8000-000000000004", paymentDate: END, amount: "99.00" },
      { id: "10000000-0000-4000-8000-000000000005", paymentDate: START, amount: "99.00", markedWrong: true },
      { id: "10000000-0000-4000-8000-000000000006", paymentDate: START, amount: "99.00", deletedAt: new Date() },
      { id: "10000000-0000-4000-8000-000000000008", paymentDate: START, amount: "99.00", loanId: deletedLoan.id },
      { id: "10000000-0000-4000-8000-000000000009", paymentDate: START, amount: "99.00", loanId: pendingLoan.id },
    ];
    await testDb.insert(payments).values(paymentRows.map((row) => ({
      ...row, loanId: row.loanId ?? loan.id, recordedBy: "integration-test-actor", depositLocation: "cash" as const,
    })));

    const result = await Effect.runPromise(getWeeklyPaymentsData(WEEK));
    expect(result.rows.map((row) => row.id)).toEqual([paymentRows[3].id, paymentRows[2].id, paymentRows[1].id]);
    expect(result.count).toBe(3);
    expect(result.total).toBe("0.35");
  });

  it("reports loans issued in the week, excludes pending and deleted loans, and includes historical issued statuses", async () => {
    const [customer] = await testDb.insert(customers).values({
      fullName: "Weekly Loan Customer", nin: "WEEKLY-REPORT-2", contact: "+256700000992", address: "Kampala",
    }).returning({ id: customers.id });
    const makeLoan = (id: string, startDate: Date, status: "pending" | "active" | "fully_paid", deletedAt?: Date) => ({
      id, customerId: customer.id, principalAmount: "0.10", issuanceFee: "0.00", interestRate: "0.1000",
      startDate, issuedBy: "integration-test-actor", disbursementSource: "cash" as const, status, deletedAt,
    });
    const loanRows = [
      makeLoan("20000000-0000-4000-8000-000000000001", new Date(START.getTime() - 1), "active"),
      makeLoan("20000000-0000-4000-8000-000000000002", START, "active"),
      makeLoan("20000000-0000-4000-8000-000000000007", START, "active"),
      makeLoan("20000000-0000-4000-8000-000000000003", new Date(END.getTime() - 1), "fully_paid"),
      makeLoan("20000000-0000-4000-8000-000000000004", END, "active"),
      makeLoan("20000000-0000-4000-8000-000000000005", START, "pending"),
      makeLoan("20000000-0000-4000-8000-000000000006", START, "active", new Date()),
    ];
    await testDb.insert(loans).values(loanRows);

    const result = await Effect.runPromise(getWeeklyLoansData(WEEK));
    expect(result.rows.map((row) => row.id)).toEqual([loanRows[3].id, loanRows[2].id, loanRows[1].id]);
    expect(result.count).toBe(3);
    expect(result.total).toBe("0.30");
    const closedLoan = result.rows.find((row) => row.id === loanRows[3].id)!;
    expect(new BigNumber(closedLoan.principalBalance).isZero()).toBe(true);
    expect(new BigNumber(closedLoan.accruedInterest).isZero()).toBe(true);
    expect(closedLoan.daysOverdue).toBe(0);
    expect(closedLoan.lastPaymentDate).toBe(loanRows[3].startDate.toISOString());
  });

  it("uses ledger-backed payment allocations and current loan projections across the selected week", async () => {
    await Effect.runPromise(createCapitalInjection({
      toLocation: "cash", amount: "2500000.00", transferredAt: "2026-09-01T09:00:00.000Z",
      note: "Weekly report integration test capital",
    }, "integration-test-actor"));
    const customerA = await Effect.runPromise(createCustomer({
      fullName: "Weekly Ledger Loan A", nin: "WEEKLY-LEDGER-A", contact: "+256700000981", address: "Kampala",
    }));
    const loanA = await Effect.runPromise(createLoan({
      customerId: customerA.id, principalAmount: "1000000.00", issuanceFee: "0.00", interestRate: "0.1000",
      minInterestDays: 30, startDate: "2026-09-21", collateral: { nature: "Other", description: "Test only" },
      disbursementSource: "cash",
    }, "integration-test-actor"));

    const customerB = await Effect.runPromise(createCustomer({
      fullName: "Weekly Ledger Loan B", nin: "WEEKLY-LEDGER-B", contact: "+256700000982", address: "Kampala",
    }));
    const loanB = await Effect.runPromise(createLoan({
      customerId: customerB.id, principalAmount: "1000000.00", issuanceFee: "0.00", interestRate: "0.1000",
      minInterestDays: 30, startDate: "2026-09-10", collateral: { nature: "Other", description: "Test only" },
      disbursementSource: "cash",
    }, "integration-test-actor"));

    const paymentA = await Effect.runPromise(recordPayment({
      loanId: loanA.id, paymentDate: "2026-09-22", amount: "200000.00", depositLocation: "cash",
    }, "integration-test-actor"));
    const priorPaymentB = await Effect.runPromise(recordPayment({
      loanId: loanB.id, paymentDate: "2026-09-20", amount: "250000.00", depositLocation: "cash",
    }, "integration-test-actor"));
    const weeklyPaymentB = await Effect.runPromise(recordPayment({
      loanId: loanB.id, paymentDate: "2026-09-22", amount: "250000.00", depositLocation: "cash",
    }, "integration-test-actor"));

    const [loanReport, paymentReport, ledgerPortions, paymentList, balances] = await Promise.all([
      Effect.runPromise(getWeeklyLoansData(WEEK)),
      Effect.runPromise(getWeeklyPaymentsData(WEEK)),
      getPaymentPortionsFromLedger([paymentA.id, priorPaymentB.id, weeklyPaymentB.id]),
      Effect.runPromise(listPayments({ page: 1, pageSize: 20 })),
      Effect.runPromise(listLoanBalances()),
    ]);

    expect(loanReport.rows.map((row) => row.id)).toContain(loanA.id);
    expect(loanReport.rows.map((row) => row.id)).not.toContain(loanB.id);
    const reportA = loanReport.rows.find((row) => row.id === loanA.id)!;
    const loanBalanceA = balances.find((row) => row.loanId === loanA.id)!;
    expect(reportA.principalBalance).toBe(loanBalanceA.totalBalanceOwed);
    expect(reportA.accruedInterest).toBe(loanBalanceA.unpaidInterest);
    expect(reportA.daysOverdue).toBe(loanBalanceA.daysOverdue);
    expect(reportA.lastPaymentDate).toBe(loanBalanceA.lastPaymentDate.toISOString());

    expect(paymentReport.rows.map((row) => row.id)).toEqual(expect.arrayContaining([paymentA.id, weeklyPaymentB.id]));
    expect(paymentReport.rows.map((row) => row.id)).not.toContain(priorPaymentB.id);
    const reportPaymentB = paymentReport.rows.find((row) => row.id === weeklyPaymentB.id)!;
    const paymentAPortion = ledgerPortions.get(paymentA.id)!;
    const priorPortion = ledgerPortions.get(priorPaymentB.id)!;
    const weeklyPortion = ledgerPortions.get(weeklyPaymentB.id)!;
    expect(new BigNumber(paymentAPortion.interestPortion).isGreaterThan(0)).toBe(true);
    expect(new BigNumber(paymentAPortion.principalPortion).isGreaterThan(0)).toBe(true);
    expect(new BigNumber(priorPortion.principalPortion).isGreaterThan(0)).toBe(true);
    expect(new BigNumber(weeklyPortion.principalPortion).isGreaterThan(0)).toBe(true);
    expect(reportPaymentB.interestPortion).toBe(weeklyPortion.interestPortion);
    expect(reportPaymentB.principalPortion).toBe(weeklyPortion.principalPortion);
    expect(reportPaymentB.principalBalanceAfter).toBe(paymentList.rows.find((row) => row.id === weeklyPaymentB.id)?.principalBalanceAfter);
    expect(reportPaymentB.principalBalanceAfter).not.toBe("1000000.00");
  });
});
