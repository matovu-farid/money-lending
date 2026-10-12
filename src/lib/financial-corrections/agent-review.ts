import { createHash } from "node:crypto"

export type AgentReviewIdentity = {
  kind: string
  subjectId: string
  planHash: string
  inputFingerprint: string
  policyVersion: string
}

export type AgentReviewRecord = AgentReviewIdentity & {
  reviewerAgentId: string
  reviewRunId: string
  evidenceJson: string
  evidenceSha256: string
  verdict: string
  findingsJson: string
  consumedAt?: Date | null
  consumedByRunId?: string | null
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value === "object" && value !== null &&
      Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, canonicalValue((value as Record<string, unknown>)[key])]))
  }
  throw new Error("Agent review evidence must be finite JSON data")
}

export function hashReviewEvidence(evidence: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(evidence))).digest("hex")
}

/** Checks the durable record; domain-specific verification must precede recording it. */
export function assertMatchingPassingAgentReview(
  review: AgentReviewRecord,
  expected: AgentReviewIdentity,
  executorAgentId: string,
): void {
  for (const key of ["kind", "subjectId", "planHash", "inputFingerprint",
    "policyVersion"] as const) {
    if (review[key] !== expected[key]) throw new Error(`Agent review ${key} does not match`)
  }
  if (!review.reviewerAgentId.startsWith("agent:") ||
      review.reviewerAgentId.trim() === "agent:") {
    throw new Error("Agent review requires a named reviewer agent")
  }
  if (!review.reviewRunId.trim()) throw new Error("Agent review requires a run identifier")
  if (!executorAgentId.startsWith("agent:") || executorAgentId.trim() === "agent:") {
    throw new Error("Financial correction requires a named executor agent")
  }
  if (executorAgentId === review.reviewerAgentId) {
    throw new Error("Reviewer and executor agents must be distinct")
  }
  if (review.consumedAt || review.consumedByRunId) {
    throw new Error("Agent review has already been consumed")
  }
  if (review.verdict !== "pass") throw new Error("A passing agent review is required")
  let evidence: unknown
  let findings: unknown
  try {
    evidence = JSON.parse(review.evidenceJson)
    findings = JSON.parse(review.findingsJson)
  } catch {
    throw new Error("Agent review evidence or findings are invalid JSON")
  }
  if (hashReviewEvidence(evidence) !== review.evidenceSha256) {
    throw new Error("Agent review evidence digest does not match")
  }
  if (typeof findings !== "object" || findings === null ||
      !("checks" in findings) || !Array.isArray(findings.checks) ||
      findings.checks.length === 0 ||
      !("issues" in findings) || !Array.isArray(findings.issues) ||
      findings.issues.length !== 0) {
    throw new Error("Agent review has missing checks or unresolved issues")
  }
}
