import { describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, unlink, symlink } from "node:fs/promises";
import { verifyHistoricalRateBackup } from "../historical-rate-backup";

const localUrl = "postgresql://faridmatovu@127.0.0.1:55439/money_lending_integration_test";

describe("historical rate repair backup gate", () => {
  it("rejects a broad or missing backup path", async () => {
    await expect(verifyHistoricalRateBackup({
      manifestPath: "/private/tmp/nested/backup.dump.manifest.json",
      expectedDumpSha256: "a".repeat(64),
      primaryUrl: localUrl,
      directUrl: localUrl,
    })).rejects.toThrow(/private|path/i);
    await expect(verifyHistoricalRateBackup({
      manifestPath: `/private/tmp/missing-${randomUUID()}.dump.manifest.json`,
      expectedDumpSha256: "a".repeat(64),
      primaryUrl: localUrl,
      directUrl: localUrl,
    })).rejects.toThrow();
  });

  it("rejects a checksum-matching fake dump even when its manifest claims audit tables", async () => {
    const path = `/private/tmp/fake-historical-rate-${randomUUID()}.dump`;
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
    const target = `/private/tmp/historical-rate-manifest-${randomUUID()}.dump.manifest.json`;
    const link = `/private/tmp/historical-rate-link-${randomUUID()}.dump.manifest.json`;
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
