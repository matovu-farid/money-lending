/** Read-only, repeatable-read preview of one deleted rollover chain. */
import "dotenv/config"
import { db } from "../src/lib/db"
import { loadDeletedRolloverSource } from "../src/services/deleted-rollover-ledger.service"
import { planDeletedRolloverLedgerRepair } from
  "../src/lib/financial-corrections/deleted-rollover-ledger"
import { verifyDeletedRolloverLedgerEvidence } from
  "../src/lib/financial-corrections/deleted-rollover-ledger-verifier"

async function main() {
  const args = process.argv.slice(2)
  if ((args.length !== 1 && !(args.length === 2 && args[1] === "--details")) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(args[0])) {
    throw new Error("Supply predecessor UUID and optional --details")
  }
  const result = await db.transaction(async (tx) => {
    const source = await loadDeletedRolloverSource(args[0], tx)
    const plan = planDeletedRolloverLedgerRepair(source)
    return { source, plan, evidence: verifyDeletedRolloverLedgerEvidence(source, plan) }
  }, { isolationLevel: "repeatable read", accessMode: "read only" })
  const { plan, source, evidence } = result
  console.log(JSON.stringify(plan, null, 2))
  console.log(JSON.stringify({ independentVerdict: evidence.verdict,
    independentIssues: evidence.issues, checks: evidence.checks }, null, 2))
  if (args[1] === "--details") {
    console.log(JSON.stringify({
      deletions: { predecessor: source.predecessor.deletedAt,
        successor: source.successor.deletedAt },
      audit: source.audits.filter((row) => ["loan.rollover", "loan.unroll", "loan.delete"]
        .includes(row.action)).map((row) => {
          let after: Record<string, unknown> = {}
          try { after = JSON.parse(row.afterValue ?? "{}") } catch { /* malformed audit is reviewed separately */ }
          return { action: row.action, entityId: row.entityId, occurredAt: row.occurredAt,
            rolledIntoLoanId: after.rolledIntoLoanId, carriedInterest: after.carriedInterest }
        }),
      interestCarryGroups: source.journals.filter((row) =>
        row.referenceType === "rollover" && row.categoryName === "Interest Earned")
        .map((row) => ({ groupId: row.journalGroupId, amount: row.amount,
          referenceId: row.referenceId, createdAt: row.createdAt })),
    }, null, 2))
  }
  if (plan.classification !== "ready" || evidence.verdict !== "pass") process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Preview failed")
  process.exitCode = 1
})
