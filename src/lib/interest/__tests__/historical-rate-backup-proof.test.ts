import { createHash, randomUUID } from "node:crypto";
import { chmod, writeFile, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { correctionTempDirectory } from "../rollover-snapshot-guard";
import { verifyHistoricalRateArchive, verifyHistoricalRateBackup,
  withIsolatedHistoricalRehearsal } from "../historical-rate-backup";

const { catalog } = vi.hoisted(() => {
  const tables = ["loans", "loan_balances", "payments", "loan_waivers", "rate_change_requests",
    "transactions", "transaction_categories", "audit_log",
    "historical_rate_repair_approvals", "historical_rate_repair_runs",
    "financial_correction_agent_reviews"];
  return { catalog: tables.flatMap((name, index) => [
    `${index + 1}; 1259 ${index + 1} TABLE public ${name} owner`,
    `${index + 101}; 0 ${index + 1} TABLE DATA public ${name} owner`,
  ]).join("\n") };
});

vi.mock("node:child_process", () => ({
  execFile: (_command: string, _args: string[], _options: unknown,
    callback: (error: Error | null, output: { stdout: string; stderr: string }) => void) =>
    callback(null, { stdout: catalog, stderr: "" }),
}));

const localUrl = "postgresql://test@127.0.0.1:55439/money_lending_integration_test";
const cleanup: string[] = [];
afterEach(async () => {
  for (const path of cleanup.splice(0)) await unlink(path);
});

describe("historical apply archive and restore gate", () => {
  it("allows archive verification without a proof only inside an isolated local rehearsal", async () => {
    const database = "money_lending_rehearsal_historical_abc123";
    const url = `postgresql://test@127.0.0.1:55439/${database}`;
    const dumpPath = `${correctionTempDirectory}/historical-rehearsal-${randomUUID()}.dump`;
    const manifestPath = `${dumpPath}.manifest.json`;
    const dump = "local rehearsal archive";
    const dumpSha256 = createHash("sha256").update(dump).digest("hex");
    await writeFile(dumpPath, dump, { flag: "wx", mode: 0o600 });
    cleanup.push(dumpPath);
    await writeFile(manifestPath, JSON.stringify({
      format: "pg_dump-custom", sourceHost: "127.0.0.1", sourceDatabase: database,
      completedAt: new Date().toISOString(), dumpPath, dumpBytes: Buffer.byteLength(dump),
      dumpSha256, historicalRateAuditTablesInDump: true,
    }), { flag: "wx", mode: 0o600 });
    cleanup.push(manifestPath);
    const gate = { manifestPath, expectedDumpSha256: dumpSha256,
      primaryUrl: url, directUrl: url };
    await expect(verifyHistoricalRateBackup(gate)).rejects.toThrow(/restore proof/i);
    expect(() => withIsolatedHistoricalRehearsal({ ...gate,
      manifestPath: `${correctionTempDirectory}/other.dump.manifest.json`,
    }, () => verifyHistoricalRateBackup(gate))).toThrow(/isolated local/i);
    await expect(withIsolatedHistoricalRehearsal(gate, () =>
      verifyHistoricalRateBackup(gate))).resolves.toEqual({ dumpPath, dumpSha256 });
    await expect(verifyHistoricalRateBackup(gate)).rejects.toThrow(/restore proof/i);
    expect(() => withIsolatedHistoricalRehearsal({ ...gate,
      primaryUrl: "postgresql://test@db.example/money_lending_rehearsal_historical_abc123",
      directUrl: "postgresql://test@db.example/money_lending_rehearsal_historical_abc123",
    }, () => verifyHistoricalRateBackup(gate))).toThrow(/isolated local/i);
  });

  it("refuses a checksum-valid catalog-complete archive until a matching isolated restore proof exists", async () => {
    const dumpPath = `${correctionTempDirectory}/historical-gate-${randomUUID()}.dump`;
    const manifestPath = `${dumpPath}.manifest.json`;
    const proofPath = `${dumpPath}.historical-restore.json`;
    const dump = "fixture archive whose catalog is supplied by the test";
    const dumpSha256 = createHash("sha256").update(dump).digest("hex");
    await writeFile(dumpPath, dump, { flag: "wx", mode: 0o600 });
    cleanup.push(dumpPath);
    await writeFile(manifestPath, JSON.stringify({
      format: "pg_dump-custom", sourceHost: "127.0.0.1",
      sourceDatabase: "money_lending_integration_test",
      completedAt: new Date().toISOString(), dumpPath,
      dumpBytes: Buffer.byteLength(dump), dumpSha256,
      historicalRateAuditTablesInDump: true,
    }), { flag: "wx", mode: 0o600 });
    cleanup.push(manifestPath);
    const gate = { manifestPath, expectedDumpSha256: dumpSha256,
      primaryUrl: localUrl, directUrl: localUrl };

    await expect(verifyHistoricalRateArchive(gate)).resolves.toEqual({ dumpPath, dumpSha256 });
    await expect(verifyHistoricalRateBackup(gate)).rejects.toThrow(/restore proof|rehearsal/i);

    await writeFile(proofPath, JSON.stringify({
      dumpSha256, sourceHost: "127.0.0.1",
      sourceDatabase: "money_lending_integration_test",
      restoredDatabase: "money_lending_rehearsal_historical_abc123",
      restoredAt: new Date().toISOString(), auditTablesPresent: true,
      loanRows: 2, paymentRows: 3, transactionRows: 8,
      waiverRows: 0, rateRequestRows: 1, categoryRows: 7, auditRows: 2,
    }), { flag: "wx", mode: 0o600 });
    await expect(verifyHistoricalRateBackup(gate)).rejects.toThrow(/stale or mismatched/i);
    await unlink(proofPath);

    await writeFile(proofPath, JSON.stringify({
      dumpSha256, sourceHost: "127.0.0.1",
      sourceDatabase: "money_lending_integration_test",
      restoredDatabase: "money_lending_rehearsal_historical_abc123",
      restoredAt: new Date().toISOString(), auditTablesPresent: true,
      loanRows: 2, paymentRows: 3, transactionRows: 8,
      waiverRows: 0, rateRequestRows: 1, categoryRows: 7, auditRows: 2,
      targetLoanId: "11111111-1111-4111-8111-111111111111",
      asOf: "2026-10-10T20:59:59.999Z", policyVersion: "v2",
      planHash: "b".repeat(64), inputFingerprint: "c".repeat(64),
      rehearsalRunId: "22222222-2222-4222-8222-222222222222",
      postPlanHash: "d".repeat(64), postClassification: "noop",
      endingPrincipal: "120000.00", postEndingPrincipal: "120000.00",
      postAccrualDelta: "0.00", paymentsUnchanged: true,
      cashUnchanged: true, journalGroupsBalanced: true,
      nonCashCorrection: true,
    }), { flag: "wx", mode: 0o600 });
    cleanup.push(proofPath);
    await expect(verifyHistoricalRateBackup(gate)).resolves.toEqual({ dumpPath, dumpSha256 });
    await chmod(proofPath, 0o644);
    await expect(verifyHistoricalRateBackup(gate)).rejects.toThrow(/restore proof|owner-only/i);
    await chmod(proofPath, 0o600);
  });
});
