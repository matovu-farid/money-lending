import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyHistoricalRateArchive } from
  "../historical-rate-backup";
import { correctionTempDirectory } from "../rollover-snapshot-guard";
import { isIsolatedRolloverRehearsalDatabase, rolloverCorrectionDataInCatalog,
  validRolloverRestoreProof, verifyRolloverCorrectionBackup } from "../rollover-backup";

const mocks = vi.hoisted(() => ({
  pending: [] as Array<{ subject_id: string; plan_hash: string;
    input_fingerprint: string; policy_version: string; evidence_sha256: string }>,
  catalog: "",
}));
vi.mock("../historical-rate-backup", () => ({
  verifyHistoricalRateArchive: vi.fn(async (gate: { manifestPath: string;
    expectedDumpSha256: string }) => ({
    dumpPath: gate.manifestPath.slice(0, -".manifest.json".length),
    dumpSha256: gate.expectedDumpSha256,
  })),
}));
vi.mock("node:child_process", () => ({
  execFile: (_command: string, _args: string[], _options: unknown,
    callback: (error: Error | null, output: { stdout: string; stderr: string }) => void) =>
    callback(null, { stdout: mocks.catalog, stderr: "" }),
}));
vi.mock("postgres", () => ({ default: () => Object.assign(
  () => Promise.resolve(mocks.pending),
  { end: async () => undefined }) }));

const tables = ["loans", "payments", "transactions", "audit_log",
  "rollover_correction_approvals", "rollover_correction_runs",
  "financial_correction_agent_reviews"];
const catalog = tables.flatMap((name, index) => [
  `${index + 1}; 0 0 TABLE public ${name} owner`,
  `${index + 101}; 0 0 TABLE DATA public ${name} owner`,
]).join("\n");
const created: string[] = [];
afterEach(async () => {
  mocks.pending = [];
  for (const path of created.splice(0)) await unlink(path);
});

describe("rollover backup gate", () => {
  it("requires full ledger and agent review tables with data entries", () => {
    expect(rolloverCorrectionDataInCatalog(catalog)).toBe(true);
    expect(rolloverCorrectionDataInCatalog(catalog.replace(
      /\d+; 0 0 TABLE DATA public financial_correction_agent_reviews owner/, "")))
      .toBe(false);
    expect(rolloverCorrectionDataInCatalog(catalog.replace(
      /\d+; 0 0 TABLE public transactions owner/, ""))).toBe(false);
  });

  it("limits the rehearsal bypass to the exact named loopback restore", () => {
    const digest = "a".repeat(64);
    const local = `postgres://tester@127.0.0.1/money_lending_rehearsal_rollover_${digest.slice(0, 12)}`;
    expect(isIsolatedRolloverRehearsalDatabase(local, local, digest)).toBe(true);
    expect(isIsolatedRolloverRehearsalDatabase(local.replace("postgres:", "http:"),
      local.replace("postgres:", "http:"), digest)).toBe(false);
    expect(isIsolatedRolloverRehearsalDatabase(local.replace("127.0.0.1", "db.example"),
      local.replace("127.0.0.1", "db.example"), digest)).toBe(false);
    expect(isIsolatedRolloverRehearsalDatabase(local, local.replace("tester", "other"),
      digest)).toBe(false);
    expect(isIsolatedRolloverRehearsalDatabase(local, local, "b".repeat(64))).toBe(false);
  });

  it("uses archive validation on the isolated restore without requiring production proof", async () => {
    mocks.catalog = catalog;
    const dumpSha256 = "a".repeat(64);
    const local = `postgres://tester@127.0.0.1/money_lending_rehearsal_rollover_${dumpSha256.slice(0, 12)}`;
    const source = "postgres://tester@db.example/money";
    const dumpPath = `${correctionTempDirectory}/rollover-local-${randomUUID()}.dump`;
    const manifestPath = `${dumpPath}.manifest.json`;
    await writeFile(manifestPath, JSON.stringify({ correctionAuditTablesInDump: true }),
      { flag: "wx", mode: 0o600 });
    created.push(manifestPath);
    await expect(verifyRolloverCorrectionBackup({ manifestPath,
      expectedDumpSha256: dumpSha256, primaryUrl: local, directUrl: local,
      rehearsalSourceUrl: source }))
      .resolves.toEqual({ dumpPath, dumpSha256 });
    expect(vi.mocked(verifyHistoricalRateArchive)).toHaveBeenLastCalledWith({
      manifestPath, expectedDumpSha256: dumpSha256,
      primaryUrl: source, directUrl: source,
    });
  });

  it("binds restore proof to archive identity and recent isolated restore", () => {
    const expected = { dumpSha256: "a".repeat(64), sourceHost: "db.example",
      sourceDatabase: "money", chainRootId: "11111111-1111-4111-8111-111111111111",
      planHash: "b".repeat(64), inputFingerprint: "c".repeat(64),
      policyVersion: "v4", reviewEvidenceSha256: "d".repeat(64) };
    const proof = { ...expected, restoredAt: new Date().toISOString(),
      restoredDatabase: `money_lending_rehearsal_rollover_${expected.dumpSha256.slice(0, 12)}`,
      auditTablesPresent: true,
      loanRows: 4, paymentRows: 1, transactionRows: 12,
      reviewId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      reviewVerdict: "pass", applied: true, reconciled: true,
      paymentsUnchanged: true, cashUnchanged: true, statusesUnchanged: true,
      sourceJournalsUnchanged: true,
      journalGroupsBalanced: true, nonCashCorrection: true };
    expect(validRolloverRestoreProof(proof, expected)).toBe(true);
    expect(validRolloverRestoreProof({ ...proof, dumpSha256: "b".repeat(64) }, expected))
      .toBe(false);
    expect(validRolloverRestoreProof({ ...proof, restoredDatabase: "money" }, expected))
      .toBe(false);
    expect(validRolloverRestoreProof({ ...proof,
      restoredAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }, expected))
      .toBe(false);
    for (const key of ["chainRootId", "planHash", "inputFingerprint",
      "policyVersion", "reviewEvidenceSha256"] as const) {
      expect(validRolloverRestoreProof({ ...proof, [key]: "wrong" }, expected)).toBe(false);
    }
    for (const key of ["reviewId", "runId", "reviewVerdict", "applied",
      "reconciled", "paymentsUnchanged", "cashUnchanged", "statusesUnchanged",
      "sourceJournalsUnchanged",
      "journalGroupsBalanced", "nonCashCorrection"] as const) {
      expect(validRolloverRestoreProof({ ...proof, [key]: null }, expected)).toBe(false);
    }
  });

  it("requires a private proof for the only pending passing production review", async () => {
    mocks.catalog = catalog;
    const dumpPath = `${correctionTempDirectory}/rollover-gate-${randomUUID()}.dump`;
    const manifestPath = `${dumpPath}.manifest.json`;
    const proofPath = `${dumpPath}.rollover-restore.json`;
    const dumpSha256 = "a".repeat(64);
    const review = { subject_id: "11111111-1111-4111-8111-111111111111",
      plan_hash: "b".repeat(64), input_fingerprint: "c".repeat(64),
      policy_version: "v4", evidence_sha256: "d".repeat(64) };
    const gate = { manifestPath, expectedDumpSha256: dumpSha256,
      primaryUrl: "postgres://tester@db.example/money", directUrl: "postgres://tester@db.example/money" };
    await writeFile(manifestPath, JSON.stringify({ correctionAuditTablesInDump: true }),
      { flag: "wx", mode: 0o600 });
    created.push(manifestPath);
    const proof = { dumpSha256, sourceHost: "db.example", sourceDatabase: "money",
      restoredDatabase: `money_lending_rehearsal_rollover_${dumpSha256.slice(0, 12)}`,
      restoredAt: new Date().toISOString(), auditTablesPresent: true,
      loanRows: 4, paymentRows: 0, transactionRows: 12,
      chainRootId: review.subject_id, planHash: review.plan_hash,
      inputFingerprint: review.input_fingerprint, policyVersion: review.policy_version,
      reviewEvidenceSha256: review.evidence_sha256,
      reviewId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      reviewVerdict: "pass", applied: true, reconciled: true,
      paymentsUnchanged: true, cashUnchanged: true, statusesUnchanged: true,
      sourceJournalsUnchanged: true,
      journalGroupsBalanced: true, nonCashCorrection: true };
    await writeFile(proofPath, JSON.stringify(proof), { flag: "wx", mode: 0o600 });
    created.push(proofPath);
    await expect(verifyRolloverCorrectionBackup(gate)).rejects.toThrow(/one pending passing review/);
    mocks.pending = [review, { ...review, plan_hash: "e".repeat(64) }];
    await expect(verifyRolloverCorrectionBackup(gate)).rejects.toThrow(/one pending passing review/);
    mocks.pending = [review];
    await expect(verifyRolloverCorrectionBackup(gate)).resolves.toEqual({ dumpPath, dumpSha256 });
    expect(vi.mocked(verifyHistoricalRateArchive)).toHaveBeenCalledWith(gate);
    mocks.pending = [{ ...review, plan_hash: "e".repeat(64) }];
    await expect(verifyRolloverCorrectionBackup(gate)).rejects.toThrow(/mismatched/);
  });
});
