import { describe, expect, it } from "vitest";
import {
  correctionAuditTablesInCatalog,
  requireCorrectionAuditTablesInDump,
  validateCorrectionDatabaseEndpoints,
  validateRolloverSnapshotTarget,
} from "../rollover-snapshot-guard";

const localUrl = "postgres://test:secret@127.0.0.1:55432/money_lending_test";

describe("validateRolloverSnapshotTarget", () => {
  it("accepts an explicitly identified database and a direct private temporary file", () => {
    const target = validateRolloverSnapshotTarget(localUrl, "127.0.0.1",
      "money_lending_test", "/private/tmp/rollover-snapshot-test.dump");
    expect(target.database).toBe("money_lending_test");
    expect(target.out).toBe("/private/tmp/rollover-snapshot-test.dump");
  });

  it("rejects host and database identity mismatches", () => {
    expect(() => validateRolloverSnapshotTarget(localUrl, "production.example",
      "money_lending_test", "/private/tmp/test.dump")).toThrow(/identity/i);
    expect(() => validateRolloverSnapshotTarget(localUrl, "127.0.0.1",
      "neondb", "/private/tmp/test.dump")).toThrow(/identity/i);
  });

  it("rejects paths outside the direct private temporary directory", () => {
    for (const out of ["/tmp/test.dump", "/private/tmp/nested/test.dump",
      "/Users/faridmatovu/projects/money-lending/test.dump", "/private/tmp/test.sql"]) {
      expect(() => validateRolloverSnapshotTarget(localUrl, "127.0.0.1",
        "money_lending_test", out)).toThrow(/snapshot path/i);
    }
  });
});

describe("correction database endpoint identity", () => {
  const pooled = "postgres://admin:secret@ep-crimson-meadow-abfn36mg-pooler.eu-west-2.aws.neon.tech/neondb";
  const direct = "postgres://admin:secret@ep-crimson-meadow-abfn36mg.eu-west-2.aws.neon.tech/neondb";
  const unrelated = "postgres://admin:secret@ep-old-bird-ab9oiggr.eu-west-2.aws.neon.tech/neondb";

  it("accepts only the direct endpoint corresponding to the pooled host", () => {
    expect(validateCorrectionDatabaseEndpoints(pooled, direct).backup.hostname)
      .toBe("ep-crimson-meadow-abfn36mg.eu-west-2.aws.neon.tech");
    expect(() => validateCorrectionDatabaseEndpoints(pooled, unrelated))
      .toThrow(/different database endpoint/i);
    expect(() => validateCorrectionDatabaseEndpoints(pooled, undefined))
      .toThrow(/direct endpoint/i);
  });

  it("allows one non-pooled local endpoint but rejects a different database or user", () => {
    expect(validateCorrectionDatabaseEndpoints(localUrl, undefined).backup.hostname)
      .toBe("127.0.0.1");
    expect(() => validateCorrectionDatabaseEndpoints(localUrl,
      "postgres://test:secret@127.0.0.1:55432/other_db")).toThrow(/different database endpoint/i);
    expect(() => validateCorrectionDatabaseEndpoints(localUrl,
      "postgres://other:secret@127.0.0.1:55432/money_lending_test"))
      .toThrow(/different database endpoint/i);
  });
});

describe("correction backup schema", () => {
  const catalog = [
    "246; 1259 19303 TABLE public rollover_correction_approvals postgres",
    "245; 1259 17540 TABLE public rollover_correction_runs postgres",
  ].join("\n");

  it("recognizes both audit tables in the actual pg_restore catalog", () => {
    expect(correctionAuditTablesInCatalog(catalog)).toBe(true);
    expect(correctionAuditTablesInCatalog(catalog.split("\n")[0])).toBe(false);
    expect(correctionAuditTablesInCatalog(catalog.replace("TABLE public", "TABLE DATA public")))
      .toBe(false);
  });

  it("rejects a pre-migration or legacy backup manifest for correction", () => {
    expect(() => requireCorrectionAuditTablesInDump({ correctionAuditTablesInDump: false }))
      .toThrow(/audit tables/i);
    expect(() => requireCorrectionAuditTablesInDump({})).toThrow(/audit tables/i);
    expect(() => requireCorrectionAuditTablesInDump({ correctionAuditTablesInDump: true }))
      .not.toThrow();
  });
});
