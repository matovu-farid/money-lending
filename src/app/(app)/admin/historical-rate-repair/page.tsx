import { getSession } from "@/lib/action-utils";
import { buildHistoricalRateRepairReport } from
  "@/lib/interest/historical-rate-repair-report";
import { loadHistoricalRateRepairPlan } from
  "@/services/historical-rate-repair.service";
import { ReviewApprovalForm } from "./review-approval-form";

type Query = { [key: string]: string | string[] | undefined };

export default async function HistoricalRateRepairReviewPage({
  searchParams,
}: { searchParams: Promise<Query> }) {
  const session = await getSession();
  const role = (session?.user as Record<string, unknown> | undefined)?.role;
  if (!session || (role !== "admin" && role !== "superAdmin")) {
    return <main className="p-6"><h1>Access denied</h1></main>;
  }

  const query = await searchParams;
  const loanId = query.loanId;
  const asOfText = query.asOf;
  const expectedHash = query.planHash;
  const expectedFingerprint = query.inputFingerprint;
  if (typeof loanId !== "string" || !/^[a-f0-9-]{36}$/i.test(loanId) ||
      typeof asOfText !== "string" ||
      typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash) ||
      typeof expectedFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    return <main className="p-6"><h1>Exact reviewed plan required</h1>
      <p>Open this page with the loan, as-of instant, plan hash, and source fingerprint from the reviewed report.</p>
    </main>;
  }
  const asOf = new Date(asOfText);
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== asOfText ||
      asOf > new Date()) {
    return <main className="p-6"><h1>Invalid review date</h1></main>;
  }
  const plan = await loadHistoricalRateRepairPlan(loanId, asOf, "v1");
  if (plan.classification !== "review" || plan.planHash !== expectedHash ||
      plan.inputFingerprint !== expectedFingerprint) {
    return <main className="p-6"><h1>Reviewed plan has changed</h1>
      <p>Generate and review a fresh preview before approving anything.</p>
    </main>;
  }
  const summary = buildHistoricalRateRepairReport({
    databaseHost: "", databaseName: "", plan,
  }).summary;

  return <main className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Historical rate correction review</h1>
      <p className="text-muted-foreground">Approval records the exact plan below. It does not change the loan or move cash; a separate backup-gated apply is required.</p>
    </header>
    <section aria-label="Reviewed correction" className="rounded-lg border p-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Loan</dt><dd className="font-mono break-all">{plan.loanId}</dd></div>
        <div><dt className="text-muted-foreground">Rate from loan start</dt><dd>{(Number(plan.correctedRate) * 100).toFixed(2)}%</dd></div>
        <div><dt className="text-muted-foreground">Settlement count</dt><dd>{summary.settlementCount}</dd></div>
        <div><dt className="text-muted-foreground">Cash receipts unchanged</dt><dd>UGX {Number(summary.unchangedCashTotal).toLocaleString("en-UG")}</dd></div>
        <div><dt className="text-muted-foreground">Interest reclassified</dt><dd>UGX {Number(summary.interestReclassification).toLocaleString("en-UG")}</dd></div>
        <div><dt className="text-muted-foreground">Non-cash accrual journal</dt><dd>UGX {Number(plan.accrualJournalDelta).toLocaleString("en-UG")}</dd></div>
        <div><dt className="text-muted-foreground">Corrected principal</dt><dd>UGX {Number(plan.endingPrincipal).toLocaleString("en-UG")}</dd></div>
        <div><dt className="text-muted-foreground">As of</dt><dd>{asOfText}</dd></div>
      </dl>
      <p className="mt-4 break-all font-mono text-xs text-muted-foreground">Plan hash: {plan.planHash}</p>
    </section>
    <ReviewApprovalForm input={{ loanId, asOf: asOfText, policyVersion: "v1",
      planHash: expectedHash, inputFingerprint: expectedFingerprint }} />
  </main>;
}
