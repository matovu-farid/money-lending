/** Record a separately attributed agent-only review of one fresh exact plan. */
import "dotenv/config"
import { db } from "../src/lib/db"
import { loadDeletedRolloverSource } from "../src/services/deleted-rollover-ledger.service"
import { planDeletedRolloverLedgerRepair } from
  "../src/lib/financial-corrections/deleted-rollover-ledger"
import { reviewDeletedRolloverLedgerRepair } from
  "../src/services/deleted-rollover-ledger-apply.service"

async function main() {
  if (process.env.CYPRESS === "true") {
    throw new Error("Deleted-rollover review cannot use the Cypress database override")
  }
  const [predecessorId, reviewRunId, ...rest] = process.argv.slice(2)
  const reviewerAgentId = `agent:${process.env.CODEX_THREAD_ID ?? ""}`
  if (rest.length || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(predecessorId ?? "") ||
      reviewerAgentId === "agent:" || !reviewRunId?.trim()) {
    throw new Error("Supply predecessor UUID and review run ID from a Codex agent task")
  }
  const plan = await db.transaction(async (tx) =>
    planDeletedRolloverLedgerRepair(
      await loadDeletedRolloverSource(predecessorId, tx)),
  { isolationLevel: "repeatable read", accessMode: "read only" })
  const review = await reviewDeletedRolloverLedgerRepair(plan, reviewerAgentId, reviewRunId)
  console.log(JSON.stringify({ predecessorId, planHash: plan.planHash,
    inputFingerprint: plan.inputFingerprint, ...review }, null, 2))
  if (review.verdict !== "pass") process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Review failed")
  process.exitCode = 1
})
