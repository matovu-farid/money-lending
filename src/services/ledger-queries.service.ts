import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments";
import { eq, and, or, lte, sql, inArray, isNull } from "drizzle-orm";
import BigNumber from "bignumber.js";
import { loans } from "@/lib/db/schema";

/**
 * Derive per-loan outstanding principal from the ledger.
 * Queries "Loans Receivable" entries grouped by loanId.
 * Asset account: DR adds, CR subtracts.
 */
export async function getLoanBalancesFromLedger(
  loanIds: string[],
  asOf?: Date,
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Map<string, BigNumber>> {
  if (loanIds.length === 0) return new Map();

  const conditions = [
    eq(transactionCategories.name, "Loans Receivable"),
    inArray(transactions.loanId, loanIds),
  ];
  if (asOf) {
    conditions.push(lte(transactions.transactionDate, asOf));
  }

  const rows = await queryDb
    .select({
      loanId: transactions.loanId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )

    .where(and(...conditions))
    .groupBy(transactions.loanId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.loanId) continue;
    const current = balances.get(row.loanId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Asset: DR adds, CR subtracts
    balances.set(
      row.loanId,
      row.txType === "debit" ? current.plus(amount) : current.minus(amount),
    );
  }
  return balances;
}

/**
 * Derive a single loan's outstanding principal from the ledger.
 */
export async function getLoanBalanceFromLedger(
  loanId: string,
  asOf?: Date,
  queryDb?: Pick<typeof db, "select">,
): Promise<BigNumber> {
  const balances = await getLoanBalancesFromLedger([loanId], asOf, queryDb);
  return balances.get(loanId) ?? new BigNumber(0);
}

export async function getSingleInterestEarnedFromLedger(
  loanId: string,
  queryDb: Pick<typeof db, "select"> = db,
) {
  return (
    (await getInterestEarnedFromLedger([loanId], queryDb)).get(loanId) ??
    new BigNumber(0)
  );
}

/**
 * Derive per-loan total interest earned (cash basis) from the ledger.
 * Queries "Interest Earned" entries grouped by loanId.
 * Revenue account: CR adds, DR subtracts.
 */
export async function getInterestEarnedFromLedger(
  loanIds: string[],
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Map<string, BigNumber>> {
  if (loanIds.length === 0) return new Map();

  const rows = await queryDb
    .select({
      loanId: transactions.loanId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(
      and(
        eq(transactionCategories.name, "Interest Earned"),
        inArray(transactions.loanId, loanIds),
        // isNull(transactions.),
      ),
    )
    .groupBy(transactions.loanId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.loanId) continue;
    const current = balances.get(row.loanId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Revenue: CR adds, DR subtracts
    balances.set(
      row.loanId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount),
    );
  }
  return balances;
}

/**
 * Derive per-investment total interest payable from the ledger.
 * Queries "Interest Payable" entries grouped by referenceId.
 * Liability account: CR adds, DR subtracts.
 */
export async function getInterestPayableFromLedger(
  investmentIds: string[],
): Promise<Map<string, BigNumber>> {
  if (investmentIds.length === 0) return new Map();

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(
      and(
        eq(transactionCategories.name, "Interest Payable"),
        inArray(transactions.referenceId, investmentIds),
      ),
    )
    .groupBy(transactions.referenceId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = balances.get(row.referenceId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Liability: CR adds, DR subtracts
    balances.set(
      row.referenceId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount),
    );
  }
  return balances;
}

/**
 * Derive per-investment creditor principal balances from the ledger.
 * Creditor Investment is a liability: CR adds, DR subtracts.
 *
 * Investment legs use referenceId = investmentId. Repayment legs use
 * referenceId = repaymentId, so we LEFT JOIN creditor_repayments to recover
 * the investmentId for those rows and group on the effective investment id.
 */
export async function getCreditorBalancesFromLedger(
  investmentIds: string[],
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Map<string, BigNumber>> {
  if (investmentIds.length === 0) return new Map();

  // transactions.referenceId is text; creditor_repayments.id and .investmentId
  // are uuid. Postgres rejects text=uuid without a cast, so we coerce the uuid
  // columns to text for join/filter/group expressions.
  const repaymentIdText = sql<string>`${creditorRepayments.id}::text`;
  const repaymentInvestmentIdText = sql<string>`${creditorRepayments.investmentId}::text`;
  const effectiveInvestmentId = sql<string>`COALESCE(${repaymentInvestmentIdText}, ${transactions.referenceId})`;

  const rows = await queryDb
    .select({
      investmentId: effectiveInvestmentId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .leftJoin(
      creditorRepayments,
      and(
        eq(transactions.referenceType, "creditor_repayment"),
        eq(transactions.referenceId, repaymentIdText),
      ),
    )
    .where(
      and(
        eq(transactionCategories.name, "Creditor Investment"),
        or(
          and(
            eq(transactions.referenceType, "creditor_investment"),
            inArray(transactions.referenceId, investmentIds),
          ),
          and(
            eq(transactions.referenceType, "creditor_repayment"),
            inArray(repaymentInvestmentIdText, investmentIds),
          ),
        ),
      ),
    )
    .groupBy(effectiveInvestmentId, transactions.type);

  const balances = new Map<string, BigNumber>();
  for (const row of rows) {
    if (!row.investmentId) continue;
    const current = balances.get(row.investmentId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);
    // Liability: CR adds, DR subtracts
    balances.set(
      row.investmentId,
      row.txType === "credit" ? current.plus(amount) : current.minus(amount),
    );
  }
  return balances;
}

/**
 * Derive per-payment interest and principal portions from the ledger.
 * Queries "Interest Earned" and "Loans Receivable" entries grouped by referenceId (paymentId).
 * - "Interest Earned" (revenue): CR adds, DR subtracts
 * - "Loans Receivable" (asset): CR adds to principal portion (asset being credited = principal repaid)
 * Returns Map<paymentId, { interestPortion: string; principalPortion: string }>
 */
export async function getPaymentPortionsFromLedger(
  paymentIds: string[],
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Map<string, { interestPortion: string; principalPortion: string }>> {
  if (paymentIds.length === 0) return new Map();

  const rows = await queryDb
    .select({
      referenceId: transactions.referenceId,
      categoryName: transactionCategories.name,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(
      and(
        inArray(transactions.referenceId, paymentIds),
        inArray(transactions.referenceType, ["payment", "payment_reversal"]),
        inArray(transactionCategories.name, [
          "Interest Earned",
          "Loans Receivable",
        ]),
      ),
    )
    .groupBy(
      transactions.referenceId,
      transactionCategories.name,
      transactions.type,
    );

  const portionMap = new Map<
    string,
    { interest: BigNumber; principal: BigNumber }
  >();

  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = portionMap.get(row.referenceId) ?? {
      interest: new BigNumber(0),
      principal: new BigNumber(0),
    };
    const amount = new BigNumber(row.total);

    if (row.categoryName === "Interest Earned") {
      // Revenue account: CR adds, DR subtracts
      current.interest =
        row.txType === "credit"
          ? current.interest.plus(amount)
          : current.interest.minus(amount);
    } else if (row.categoryName === "Loans Receivable") {
      // Asset account: CR adds to principal portion (principal repaid)
      current.principal =
        row.txType === "credit"
          ? current.principal.plus(amount)
          : current.principal.minus(amount);
    }

    portionMap.set(row.referenceId, current);
  }

  const result = new Map<
    string,
    { interestPortion: string; principalPortion: string }
  >();
  for (const [paymentId, portions] of portionMap) {
    result.set(paymentId, {
      interestPortion: portions.interest.toFixed(2),
      principalPortion: portions.principal.toFixed(2),
    });
  }
  return result;
}

export async function getCreditorRepaymentPortionsFromLedger(
  repaymentIds: string[],
): Promise<Map<string, { interestPortion: string; principalPortion: string }>> {
  if (repaymentIds.length === 0) return new Map();

  const rows = await db
    .select({
      referenceId: transactions.referenceId,
      categoryName: transactionCategories.name,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(
      and(
        inArray(transactions.referenceId, repaymentIds),
        eq(transactions.referenceType, "creditor_repayment"),
        inArray(transactionCategories.name, [
          "Interest Payments",
          "Creditor Investment",
        ]),
      ),
    )
    .groupBy(
      transactions.referenceId,
      transactionCategories.name,
      transactions.type,
    );

  const portionMap = new Map<
    string,
    { interest: BigNumber; principal: BigNumber }
  >();

  for (const row of rows) {
    if (!row.referenceId) continue;
    const current = portionMap.get(row.referenceId) ?? {
      interest: new BigNumber(0),
      principal: new BigNumber(0),
    };
    const amount = new BigNumber(row.total);

    if (row.categoryName === "Interest Payments") {
      // Expense account: DR adds, CR subtracts
      current.interest =
        row.txType === "debit"
          ? current.interest.plus(amount)
          : current.interest.minus(amount);
    } else if (row.categoryName === "Creditor Investment") {
      // Liability account: DR adds (decrease = principal repaid), CR subtracts
      current.principal =
        row.txType === "debit"
          ? current.principal.plus(amount)
          : current.principal.minus(amount);
    }

    portionMap.set(row.referenceId, current);
  }

  const result = new Map<
    string,
    { interestPortion: string; principalPortion: string }
  >();
  for (const [repaymentId, portions] of portionMap) {
    result.set(repaymentId, {
      interestPortion: portions.interest.toFixed(2),
      principalPortion: portions.principal.toFixed(2),
    });
  }
  return result;
}

/**
 * Derive total capital invested by creditors from the ledger.
 * Queries "Creditor Investment" CR entries (liability increase = investment received).
 * Returns the gross total invested (not net of repayments).
 */
export async function getCreditorTotalInvestedFromLedger(
  investmentIds: string[],
): Promise<BigNumber> {
  if (investmentIds.length === 0) return new BigNumber(0);

  const rows = await db
    .select({
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(
      and(
        eq(transactionCategories.name, "Creditor Investment"),
        eq(transactions.referenceType, "creditor_investment"),
        inArray(transactions.referenceId, investmentIds),
      ),
    )
    .groupBy(transactions.type);

  let total = new BigNumber(0);
  for (const row of rows) {
    const amount = new BigNumber(row.total);
    // Liability: CR adds (investment received)
    if (row.txType === "credit") total = total.plus(amount);
  }
  return total;
}

/**
 * Derive total amount repaid to creditors from the ledger.
 * Queries "Creditor Investment" DR entries (liability decrease = principal repaid)
 * plus "Interest Payments" DR entries (expense = interest paid).
 *
 * Repayment ledger legs have referenceId = repaymentId, so we JOIN
 * creditor_repayments to filter by the investmentIds those repayments belong to.
 */
export async function getCreditorTotalRepaidFromLedger(
  investmentIds: string[],
): Promise<BigNumber> {
  if (investmentIds.length === 0) return new BigNumber(0);

  // See getCreditorBalancesFromLedger — uuid columns need ::text casts for
  // comparison with the text `transactions.referenceId` and the string[] input.
  const repaymentIdText = sql<string>`${creditorRepayments.id}::text`;
  const repaymentInvestmentIdText = sql<string>`${creditorRepayments.investmentId}::text`;

  const rows = await db
    .select({
      txType: transactions.type,
      categoryName: transactionCategories.name,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .innerJoin(
      creditorRepayments,
      eq(transactions.referenceId, repaymentIdText),
    )
    .where(
      and(
        eq(transactions.referenceType, "creditor_repayment"),
        inArray(repaymentInvestmentIdText, investmentIds),
        inArray(transactionCategories.name, [
          "Creditor Investment",
          "Interest Payments",
        ]),
      ),
    )
    .groupBy(transactions.type, transactionCategories.name);

  let total = new BigNumber(0);
  for (const row of rows) {
    const amount = new BigNumber(row.total);
    if (row.categoryName === "Creditor Investment" && row.txType === "debit") {
      // Liability DR = principal repaid
      total = total.plus(amount);
    } else if (
      row.categoryName === "Interest Payments" &&
      row.txType === "debit"
    ) {
      // Expense DR = interest paid
      total = total.plus(amount);
    }
  }
  return total;
}
/**
 * Derive per-loan remaining principal from the ledger.
 * Queries "Loans Receivable" entries grouped by loanId.
 *
 * Loans Receivable is an Asset:
 *   - Debit  = principal increases (loan issued or payment reversed)
 *   - Credit = principal decreases (principal repaid)
 */
export async function getRemainingPrincipalFromLedger(
  loanIds: string[],
  asOf?: Date,
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Map<string, BigNumber>> {
  if (loanIds.length === 0) return new Map();

  const conditions = [
    eq(transactionCategories.name, "Loans Receivable"),
    inArray(transactions.loanId, loanIds),
  ];

  if (asOf) {
    conditions.push(lte(transactions.transactionDate, asOf));
  }

  const rows = await queryDb
    .select({
      loanId: transactions.loanId,
      txType: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(and(...conditions))
    .groupBy(transactions.loanId, transactions.type);

  const balances = new Map<string, BigNumber>();

  for (const row of rows) {
    if (!row.loanId) continue;

    const current = balances.get(row.loanId) ?? new BigNumber(0);
    const amount = new BigNumber(row.total);

    balances.set(
      row.loanId,
      row.txType === "debit"
        ? current.plus(amount) // Asset increases
        : current.minus(amount), // Asset decreases
    );
  }

  return balances;
}

/**
 * Derive a single loan's remaining principal from the ledger.
 */
export async function getRemainingPrincipalForLoanFromLedger(
  loanId: string,
  asOf?: Date,
  queryDb?: Pick<typeof db, "select">,
): Promise<BigNumber> {
  const balances = await getRemainingPrincipalFromLedger(
    [loanId],
    asOf,
    queryDb,
  );

  return balances.get(loanId) ?? new BigNumber(0);
}