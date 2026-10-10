import BigNumber from "bignumber.js"
import { getSession } from "@/lib/action-utils"
import { loadPortfolioAccrualPlan } from "@/services/portfolio-accrual-repair.service"
import { ReviewApprovalForm } from "./review-approval-form"

type Query = { [key: string]: string | string[] | undefined }

function ugx(value: string): string {
  return Number(value).toLocaleString("en-UG", { maximumFractionDigits: 2 })
}

export default async function PortfolioAccrualReviewPage({
  searchParams,
}: { searchParams: Promise<Query> }) {
  const session = await getSession()
  const role = (session?.user as Record<string, unknown> | undefined)?.role
  if (!session || (role !== "admin" && role !== "superAdmin")) {
    return <main className="p-6"><h1>Access denied</h1></main>
  }
  const query = await searchParams
  const loanId = query.loanId
  const asOfText = query.asOf
  const expectedHash = query.planHash
  const expectedFingerprint = query.inputFingerprint
  if (typeof loanId !== "string" || !/^[a-f0-9-]{36}$/i.test(loanId) ||
      typeof asOfText !== "string" ||
      typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash) ||
      typeof expectedFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    return <main className="p-6"><h1>Exact reviewed plan required</h1>
      <p>Open this page with the loan, as-of instant, plan hash, and source fingerprint from the private preview.</p>
    </main>
  }
  const asOf = new Date(asOfText)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== asOfText ||
      asOf > new Date()) {
    return <main className="p-6"><h1>Invalid review date</h1></main>
  }
  const plan = await loadPortfolioAccrualPlan(loanId, asOf)
  if (plan.classification !== "ready" || plan.planHash !== expectedHash ||
      plan.inputFingerprint !== expectedFingerprint) {
    return <main className="p-6"><h1>Reviewed plan has changed</h1>
      <p>Generate a fresh read-only preview before approving anything.</p>
    </main>
  }
  const increases = plan.entries.reduce((sum, entry) => {
    const delta = new BigNumber(entry.delta)
    return delta.gt(0) ? sum.plus(delta) : sum
  }, new BigNumber(0))
  const reversals = plan.entries.reduce((sum, entry) => {
    const delta = new BigNumber(entry.delta)
    return delta.lt(0) ? sum.plus(delta.abs()) : sum
  }, new BigNumber(0))
  const net = increases.minus(reversals)

  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Portfolio interest accrual review</h1>
      <p className="text-muted-foreground">This approval records the exact non-cash journal plan below. It does not apply it. Applying still requires a verified backup and separate operator step.</p>
    </header>
    <section aria-label="Reviewed accrual totals" className="rounded-lg border p-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-sm text-muted-foreground">Loan</dt><dd className="break-all font-mono">{plan.loanId}</dd></div>
        <div><dt className="text-sm text-muted-foreground">As of</dt><dd>{asOfText}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Dated journal pairs</dt><dd>{plan.entries.length}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Interest accrued</dt><dd>UGX {ugx(increases.toFixed(2))}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Settlement reversals</dt><dd>UGX {ugx(reversals.toFixed(2))}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Net income and asset change</dt><dd className="font-semibold">UGX {ugx(net.toFixed(2))}</dd></div>
      </dl>
      <p className="mt-4 text-sm">Cash receipts, payment dates, and loan principal remain unchanged.</p>
      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">Plan hash: {plan.planHash}</p>
    </section>
    <section aria-label="Dated journal changes" className="space-y-3">
      <h2 className="text-lg font-semibold">Dated journal changes</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-muted/40"><tr>
            <th scope="col" className="p-3">Effective date</th>
            <th scope="col" className="p-3">Period</th>
            <th scope="col" className="p-3 text-right">Before receivable</th>
            <th scope="col" className="p-3 text-right">Change</th>
            <th scope="col" className="p-3 text-right">After receivable</th>
          </tr></thead>
          <tbody>{plan.entries.map((entry, index) => <tr key={`${entry.date.toISOString()}-${index}`} className="border-t">
            <td className="p-3 font-mono">{entry.date.toISOString().slice(0, 10)}</td>
            <td className="p-3 font-mono">{entry.period}</td>
            <td className="p-3 text-right tabular-nums">UGX {ugx(entry.existingReceivable)}</td>
            <td className="p-3 text-right tabular-nums">UGX {ugx(entry.delta)}</td>
            <td className="p-3 text-right tabular-nums">UGX {ugx(entry.resultingReceivable)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <ReviewApprovalForm input={{ loanId, asOf: asOfText,
      policyVersion: plan.policyVersion, planHash: expectedHash,
      inputFingerprint: expectedFingerprint }} />
  </main>
}
