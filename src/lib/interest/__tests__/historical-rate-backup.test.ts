import { describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, unlink, symlink } from "node:fs/promises";
import { validHistoricalRestoreProof, verifyHistoricalRateBackup } from "../historical-rate-backup";
import { correctionTempDirectory } from "../rollover-snapshot-guard";

const localUrl = "postgresql://faridmatovu@127.0.0.1:55439/money_lending_integration_test";

describe("historical rate repair backup gate", () => {
  it("requires a fresh matching isolated restore with historical source counts", () => {
    const expected = { dumpSha256: "a".repeat(64), sourceHost: "db.example",
      sourceDatabase: "money" };
    const proof = { ...expected, restoredAt: new Date().toISOString(),
      restoredDatabase: "money_lending_rehearsal_historical_abc123",
      auditTablesPresent: true, loanRows: 2, paymentRows: 3,
      transactionRows: 8, waiverRows: 0, rateRequestRows: 1,
      categoryRows: 7, auditRows: 2,
      targetLoanId: "11111111-1111-4111-8111-111111111111",
      asOf: "2026-10-10T20:59:59.999Z", policyVersion: "v2",
      planHash: "b".repeat(64), inputFingerprint: "c".repeat(64),
      rehearsalRunId: "22222222-2222-4222-8222-222222222222",
      postPlanHash: "d".repeat(64), postClassification: "noop",
      endingPrincipal: "120000.00", postEndingPrincipal: "120000.00",
      postAccrualDelta: "0.00", paymentsUnchanged: true,
      cashUnchanged: true, journalGroupsBalanced: true,
      nonCashCorrection: true };
    expect(validHistoricalRestoreProof(proof, expected)).toBe(true);
    for (const altered of [
      { dumpSha256: "b".repeat(64) }, { sourceHost: "elsewhere" },
      { restoredDatabase: "money" }, { sourceDatabase: proof.restoredDatabase },
      { auditTablesPresent: false },
      { restoredAt: "2000-01-01T00:00:00.000Z" },
      { loanRows: 0 }, { transactionRows: 0 }, { rateRequestRows: -1 },
      { categoryRows: 0 }, { waiverRows: undefined },
      { targetLoanId: undefined }, { asOf: "bad" },
      { planHash: undefined }, { inputFingerprint: undefined },
      { rehearsalRunId: undefined }, { postClassification: "review" },
      { postAccrualDelta: "1.00" }, { endingPrincipal: "120000.00", postEndingPrincipal: "120001.00" },
      { paymentsUnchanged: false }, { cashUnchanged: false },
      { journalGroupsBalanced: false }, { nonCashCorrection: false },
    ]) {
      expect(validHistoricalRestoreProof({ ...proof, ...altered }, expected)).toBe(false);
    }
    const countsOnly = { ...proof } as Record<string, unknown>;
    delete countsOnly.rehearsalRunId;
    expect(validHistoricalRestoreProof(countsOnly, expected)).toBe(false);
  });

  it("rejects a broad or missing backup path", async () => {
    await expect(verifyHistoricalRateBackup({
      manifestPath: `${correctionTempDirectory}/nested/backup.dump.manifest.json`,
      expectedDumpSha256: "a".repeat(64),
      primaryUrl: localUrl,
      directUrl: localUrl,
    })).rejects.toThrow(/private|path/i);
    await expect(verifyHistoricalRateBackup({
      manifestPath: `${correctionTempDirectory}/missing-${randomUUID()}.dump.manifest.json`,
      expectedDumpSha256: "a".repeat(64),
      primaryUrl: localUrl,
      directUrl: localUrl,
    })).rejects.toThrow();
  });

  it("rejects a checksum-matching fake dump even when its manifest claims audit tables", async () => {
    const path = `${correctionTempDirectory}/fake-historical-rate-${randomUUID()}.dump`;
    const manifestPath = `${path}.manifest.json`;
    const dump = "not a postgres custom-format dump";
    const sha = createHash("sha256").update(dump).digest("hex");
    await writeFile(path, dump, { flag: "wx", mode: 0o600 });
    await writeFile(manifestPath, JSON.stringify({
      format: "pg_dump-custom",
      sourceHost: "127.0.0.1",
      sourceDatabase: "money_lending_integration_test",
      completedAt: new Date().toISOString(),
      dumpPath: path,
      dumpBytes: Buffer.byteLength(dump),
      dumpSha256: sha,
      historicalRateAuditTablesInDump: true,
    }), { flag: "wx", mode: 0o600 });
    try {
      await expect(verifyHistoricalRateBackup({
        manifestPath,
        expectedDumpSha256: sha,
        primaryUrl: localUrl,
        directUrl: localUrl,
      })).rejects.toThrow(/restore catalog|pg_restore|backup/i);
    } finally {
      await unlink(manifestPath);
      await unlink(path);
    }
  });

  it("rejects a symlinked manifest before reading its claims", async () => {
    const target = `${correctionTempDirectory}/historical-rate-manifest-${randomUUID()}.dump.manifest.json`;
    const link = `${correctionTempDirectory}/historical-rate-link-${randomUUID()}.dump.manifest.json`;
    await writeFile(target, "{}", { flag: "wx", mode: 0o600 });
    await symlink(target, link);
    try {
      await expect(verifyHistoricalRateBackup({
        manifestPath: link, expectedDumpSha256: "a".repeat(64),
        primaryUrl: localUrl, directUrl: localUrl,
      })).rejects.toThrow(/owner-only|regular/i);
    } finally {
      await unlink(link);
      await unlink(target);
    }
  });
});
