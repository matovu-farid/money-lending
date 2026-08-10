import { describe, it, expect, beforeEach } from "vitest";
import { Effect, Exit } from "effect";
import { eq } from "drizzle-orm";
import BigNumber from "bignumber.js";
import { resetDb, testDb, seedCategories } from "./setup";
import { createCustomer } from "@/services/customer.service";
import { createLoan } from "@/services/loan.service";
import {
  undoLoanWaiver,
  waiveLoanAmount,
} from "@/services/loan-waiver.service";
import { computeSingleLoanBalanceData } from "@/lib/interest/loanBalanceData";
import { loans } from "@/lib/db/schema/loans";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import {
  getLoanBalancesFromLedger,
  getWaiverPortionsFromLedger,
} from "@/services/ledger-queries.service";
import { ValidationError } from "@/lib/errors";

async function makeCustomer() {
  return Effect.runPromise(
    createCustomer({
      fullName: "Waiver Test Customer",
      nin: "W0000000000000",
      contact: "+256700000001",
      address: "Kampala, Uganda",
    }),
  );
}

async function makeLoan(
  customerId: string,
  principal = "1000000.00",
  rate = "0.10",
) {
  return Effect.runPromise(
    createLoan(
      {
        customerId,
        principalAmount: principal,
        issuanceFee: "50000.00",
        interestRate: rate,
        minInterestDays: 30,
        startDate: "2025-01-01",
        collateral: { nature: "Land title", description: "Test collateral" },
        disbursementSource: "cash",
      },
      "test-actor",
    ),
  );
}

const TEST_TIMEOUT = 30_000;

describe(
  "Loan Waiver Service — Integration",
  { timeout: TEST_TIMEOUT, sequential: true },
  () => {
    beforeEach(async () => {
      await resetDb();
      await seedCategories();
    }, TEST_TIMEOUT);

    it("partial principal waiver reduces ledger balance", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id);

      const before = await getLoanBalancesFromLedger([loan.id]);
      expect(before.get(loan.id)?.toFixed(0)).toBe("1000000");

      const result = await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: "200000",
          reason: "Hardship principal reduction for customer",
        },
        "test-actor",
      );

      expect(result.principalPortion).toBe("200000.00");
      expect(new BigNumber(result.interestPortion).isZero()).toBe(true);

      const after = await getLoanBalancesFromLedger([loan.id]);
      expect(after.get(loan.id)?.toFixed(0)).toBe("800000");

      const [row] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id));
      expect(row.status).toBe("active");
    });

    it("interest waiver reduces unpaid interest via settlement date", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id, "1000000.00", "0.10");

      const beforeBalance = await computeSingleLoanBalanceData(
        loan.id,
        new Date("2025-02-15T12:00:00.000Z"),
      );
      expect(new BigNumber(beforeBalance.unpaidInterest).isGreaterThan(0)).toBe(
        true,
      );

      await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: beforeBalance.unpaidInterest,
          reason: "Interest forgiveness after negotiation meeting",
        },
        "test-actor",
      );

      const afterBalance = await computeSingleLoanBalanceData(
        loan.id,
        new Date(),
      );
      expect(new BigNumber(afterBalance.unpaidInterest).isLessThanOrEqualTo(0)).toBe(
        true,
      );
    });

    it("full waiver marks loan fully_paid", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id, "100000.00", "0.10");

      const info = await computeSingleLoanBalanceData(loan.id, new Date());
      const totalOwed = new BigNumber(info.remainingPrincipalAmount).plus(
        info.unpaidInterest,
      );

      await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: totalOwed.toFixed(0),
          reason: "Complete debt forgiveness approved by management",
        },
        "test-actor",
      );

      const [row] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id));
      expect(row.status).toBe("fully_paid");
    });

    it("undoes a full waiver, reverses the ledger, and reopens the loan", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id, "100000.00", "0.10");
      const info = await computeSingleLoanBalanceData(loan.id, new Date());
      const totalOwed = new BigNumber(info.remainingPrincipalAmount).plus(
        info.unpaidInterest,
      );

      const waiverResult = await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: totalOwed.toFixed(0),
          reason: "Complete debt forgiveness approved by management",
        },
        "test-actor",
      );

      const [settledLoan] = await testDb
        .select()
        .from(loans)
        .where(eq(loans.id, loan.id));
      expect(settledLoan.status).toBe("fully_paid");

      const result = await undoLoanWaiver(
        {
          waiverId: waiverResult.waiver.id,
          reason: "Customer settlement correction reviewed",
        },
        "test-actor",
      );

      expect(result).toMatchObject({
        loanId: loan.id,
        waiverId: waiverResult.waiver.id,
        reversedAmount: waiverResult.waiver.amount,
        previousStatus: "fully_paid",
        status: "active",
      });
      expect(
        (await getLoanBalancesFromLedger([loan.id])).get(loan.id)?.toFixed(0),
      ).toBe("100000");

      const [undoneWaiver] = await testDb
        .select()
        .from(loanWaivers)
        .where(eq(loanWaivers.id, waiverResult.waiver.id));
      expect(undoneWaiver.deletedAt).not.toBeNull();
    });

    it("undoes interest and principal using exact stored portions", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id, "1000000.00", "0.10");
      const info = await computeSingleLoanBalanceData(loan.id, new Date());
      const amount = new BigNumber(info.unpaidInterest).plus(50000);

      const waiverResult = await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: amount.toFixed(0),
          reason: "Partial waiver approved after account review",
        },
        "test-actor",
      );
      expect(new BigNumber(waiverResult.interestPortion).isGreaterThan(0)).toBe(
        true,
      );
      expect(new BigNumber(waiverResult.principalPortion).isGreaterThan(0)).toBe(
        true,
      );

      await undoLoanWaiver(
        {
          waiverId: waiverResult.waiver.id,
          reason: "Partial waiver correction approved by management",
        },
        "test-actor",
      );

      const reversalRows = await testDb
        .select({
          categoryName: transactionCategories.name,
          type: transactions.type,
          amount: transactions.amount,
          referenceType: transactions.referenceType,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id),
        )
        .where(eq(transactions.referenceId, waiverResult.waiver.id));
      const reversals = reversalRows.filter(
        (row) => row.referenceType === "loan_waiver_reversal",
      );

      expect(reversals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            categoryName: "Interest Earned",
            type: "debit",
            amount: waiverResult.interestPortion,
          }),
          expect.objectContaining({
            categoryName: "Loans Receivable",
            type: "debit",
            amount: waiverResult.principalPortion,
          }),
          expect.objectContaining({
            categoryName: "Loan Losses",
            type: "credit",
            amount: waiverResult.interestPortion,
          }),
          expect.objectContaining({
            categoryName: "Loan Losses",
            type: "credit",
            amount: waiverResult.principalPortion,
          }),
        ]),
      );
    });

    it("rejects undoing a waiver on a historical loan", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id);
      const waiverResult = await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: "10000",
          reason: "Historical loan waiver for rejection test",
        },
        "test-actor",
      );
      await testDb
        .update(loans)
        .set({ status: "rolled_over" })
        .where(eq(loans.id, loan.id));

      await expect(
        undoLoanWaiver(
          {
            waiverId: waiverResult.waiver.id,
            reason: "Attempted correction on historical loan",
          },
          "test-actor",
        ),
      ).rejects.toMatchObject({ _tag: "ValidationError" });
    });

    it("rejects a waiver that was already undone", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id);
      const waiverResult = await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: "10000",
          reason: "Undo retry behavior verification",
        },
        "test-actor",
      );

      await undoLoanWaiver(
        {
          waiverId: waiverResult.waiver.id,
          reason: "First undo approved after review",
        },
        "test-actor",
      );

      await expect(
        undoLoanWaiver(
          {
            waiverId: waiverResult.waiver.id,
            reason: "Second undo should be rejected safely",
          },
          "test-actor",
        ),
      ).rejects.toMatchObject({ _tag: "WaiverNotFound" });
    });

    it("rejects an unknown waiver without posting a reversal", async () => {
      await expect(
        undoLoanWaiver(
          {
            waiverId: "00000000-0000-4000-8000-000000000099",
            reason: "Unknown waiver correction should be rejected",
          },
          "test-actor",
        ),
      ).rejects.toMatchObject({ _tag: "WaiverNotFound" });

      const reversalRows = await testDb
        .select()
        .from(transactions)
        .where(eq(transactions.referenceType, "loan_waiver_reversal"));
      expect(reversalRows).toHaveLength(0);
    });

    it("posts loan_waiver journal entries with correct categories", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id);

      const result = await waiveLoanAmount(
        {
          loanId: loan.id,
          amount: "150000",
          reason: "Partial waiver after customer complaint review",
        },
        "test-actor",
      );

      const portions = await getWaiverPortionsFromLedger([result.waiver.id]);
      const portion = portions.get(result.waiver.id);
      expect(portion).toBeDefined();
      expect(
        new BigNumber(portion!.interestPortion).plus(portion!.principalPortion),
      ).toEqual(new BigNumber(result.waiver.amount));

      const waiverTxns = await testDb
        .select({
          categoryName: transactionCategories.name,
          type: transactions.type,
          referenceType: transactions.referenceType,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id),
        )
        .where(eq(transactions.referenceId, result.waiver.id));

      expect(
        waiverTxns.every((t) => t.referenceType === "loan_waiver"),
      ).toBe(true);
      expect(waiverTxns.some((t) => t.categoryName === "Loan Losses")).toBe(
        true,
      );
    });

    it("rejects waiver on non-operational loan", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id);

      await testDb
        .update(loans)
        .set({ status: "fully_paid" })
        .where(eq(loans.id, loan.id));

      await expect(
        waiveLoanAmount(
          {
            loanId: loan.id,
            amount: "10000",
            reason: "Should fail on closed loan status check",
          },
          "test-actor",
        ),
      ).rejects.toMatchObject({ _tag: "ValidationError" });
    });

    it("rejects over-waiver amounts", async () => {
      const customer = await makeCustomer();
      const loan = await makeLoan(customer.id);

      await expect(
        waiveLoanAmount(
          {
            loanId: loan.id,
            amount: "999999999",
            reason: "Attempting to waive far more than total owed today",
          },
          "test-actor",
        ),
      ).rejects.toMatchObject({ _tag: "ValidationError" });
    });
  },
);
