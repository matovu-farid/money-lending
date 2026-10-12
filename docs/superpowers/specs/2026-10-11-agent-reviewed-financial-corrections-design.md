# Agent-reviewed financial corrections

**Date:** 2026-10-11  
**Status:** Approved for implementation by the user's instruction to implement an autonomous, agent-only correction path. This supersedes the *human approval* clauses of the 2026-10-10 portfolio-accrual and historical-rate repair designs; their calculation, backup, locking, and reconciliation gates remain.

## Purpose and boundary

Financial *corrections* use a separately attributed reviewing agent, not an administrator's identity or signature. This is the default for existing and future correction workflows. Ordinary business approval of new loans, payments, and unrelated operations is unchanged. No correction may be posted just because a language model says it looks right: source evidence and deterministic checks must support the result. A correction with missing, ambiguous, stale, or contradictory evidence remains unapplied and is reported for investigation. No guessed ledger entry is allowed.

## Approaches considered

1. **Reusable agent-review gate (chosen):** a durable review record bound to one workflow, subject, policy version, input fingerprint, and plan hash. Each correction supplies a domain verifier; posting consumes that exact record. One audit model serves future corrections.
2. Separate agent-review columns and ad hoc logic for each correction table: smaller first patch, but inconsistent provenance and easy to bypass in later workflows.
3. Synthetic administrator account: reuses existing foreign keys, but falsely attributes an agent decision to a human and grants an inappropriate role.

## Review and attribution

The reusable review record stores a correction kind, subject ID, plan hash, source fingerprint, policy version, reviewer-agent identifier, review-run identifier, evidence/check digest, verdict, findings, and time. A distinct reviewer agent examines raw loan terms, effective dates, settlements, rollover links, prior journals, and the proposed journal effects. For each correction kind, a deterministic verifier checks the evidence against the current source snapshot and the exact plan. The portfolio verifier checks every dated checkpoint and balanced journal delta, not just the final total. A passing verdict requires no unresolved exception. Agent identity metadata is an operational audit trail; it is not represented as cryptographic attestation by the Codex runtime.

Existing human approval rows and completed runs remain historical facts. New portfolio-accrual, historical-rate, and rollover-correction runs reference the agent review and record an agent executor identity. They do not invent a `user.id` or populate `audit_log.actor_id` with a human. Agent audit events retain their structured executor/reviewer identity and remain visible in Activity despite the null human actor. Journal `recorded_by` identifies the agent/operator. The existing admin approval UI becomes read-only for corrections; production posting does not require a human click. Ordinary admin permissions remain in place for unrelated operations. A new correction workflow must provide its own independent evidence verifier before the shared agent gate can post it.

## Apply and recovery

The operator accepts only a passing, unconsumed, exact agent review for the current plan. Existing workflow safeguards still apply: matching live database identity, verified full-data backup and isolated restore/rehearsal where required, source re-read under a serializable loan/chain lock, balanced non-cash journal groups, idempotent run identity, and post-write re-planning to `noop`. The review's hash/fingerprint/policy must match again inside the posting transaction. A stale plan, mismatched evidence, failed accounting check, or failed post-write reconciliation aborts without partial journals. Re-running an already applied exact plan reports the prior run; it never duplicates postings. Historical-rate corrections retain their effective-from-start audit marker without misusing a human actor ID; rollover corrections retain their chain-wide source lock and snapshot proof.

For the pending portfolio catch-up, review each loan independently. Examine unusually large plans rather than waiving them by threshold. Apply only passing plans; keep blocked loans and unresolved anomalies on a machine-readable exception report. A new backup/rehearsal is required if prior proof expires or code/schema changes invalidate it. After posting, compare journal legs, cash invariance, loan balances, and fresh `noop` plans against the reviewed evidence; then report applied, no-op, and unresolved loans separately.

## Verification

Test failure modes first: forged or missing review, mismatched agent/plan/evidence, stale fingerprint, blocked plan, unsafe database/backup, duplicate run, unbalanced journal, partial-write rollback, and post-write non-`noop`. Add reference fixtures for interest at month ends and payment/rollover boundaries, including backdated starts. Run focused unit/integration tests, typecheck, and Cypress for any correction UI changed. Verify a restored isolated database end-to-end before production use. Track unrelated baseline test failures separately; never call an unverified production posting successful.
