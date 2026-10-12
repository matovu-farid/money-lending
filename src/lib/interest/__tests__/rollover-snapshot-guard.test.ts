import { describe, expect, it } from "vitest";
import {
  correctionAuditTablesInCatalog,
  correctionTempDirectory,
  historicalRateDataInCatalog,
  historicalRateAuditTablesInCatalog,
  requireCorrectionAuditTablesInDump,
  requireHistoricalRateAuditTablesInDump,
  validateCorrectionDatabaseEndpoints,
  validateRolloverSnapshotTarget,
} from "../rollover-snapshot-guard";

const localUrl = "postgres://test:secret@127.0.0.1:55432/money_lending_test";

describe("validateRolloverSnapshotTarget", () => {
  it("accepts an explicitly identified database and a direct private temporary file", () => {
    const target = validateRolloverSnapshotTarget(localUrl, "127.0.0.1",
      "money_lending_test", `${correctionTempDirectory}/rollover-snapshot-test.dump`);
    expect(target.database).toBe("money_lending_test");
    expect(target.out).toBe(`${correctionTempDirectory}/rollover-snapshot-test.dump`);
  });

  it("rejects host and database identity mismatches", () => {
    expect(() => validateRolloverSnapshotTarget(localUrl, "production.example",
      "money_lending_test", `${correctionTempDirectory}/test.dump`)).toThrow(/identity/i);
    expect(() => validateRolloverSnapshotTarget(localUrl, "127.0.0.1",
      "neondb", `${correctionTempDirectory}/test.dump`)).toThrow(/identity/i);
  });

  it("rejects paths outside the direct private temporary directory", () => {
    for (const out of [`${correctionTempDirectory}/nested/test.dump`,
      "/Users/faridmatovu/projects/money-lending/test.dump",
      `${correctionTempDirectory}/test.sql`]) {
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
    "249; 1259 17541 TABLE public financial_correction_agent_reviews postgres",
    "346; 0 19303 TABLE DATA public rollover_correction_approvals postgres",
    "345; 0 17540 TABLE DATA public rollover_correction_runs postgres",
    "349; 0 17541 TABLE DATA public financial_correction_agent_reviews postgres",
  ].join("\n");

  it("requires rollover and agent review TABLE and TABLE DATA entries", () => {
    expect(correctionAuditTablesInCatalog(catalog)).toBe(true);
    expect(correctionAuditTablesInCatalog(catalog.split("\n")[0])).toBe(false);
    expect(correctionAuditTablesInCatalog(catalog.replace("TABLE public", "TABLE DATA public")))
      .toBe(false);
    expect(correctionAuditTablesInCatalog(catalog.replace(
      /349;[^\n]*financial_correction_agent_reviews[^\n]*/, ""))).toBe(false);
  });

  it("rejects a pre-migration or legacy backup manifest for correction", () => {
    expect(() => requireCorrectionAuditTablesInDump({ correctionAuditTablesInDump: false }))
      .toThrow(/audit tables/i);
    expect(() => requireCorrectionAuditTablesInDump({})).toThrow(/audit tables/i);
    expect(() => requireCorrectionAuditTablesInDump({ correctionAuditTablesInDump: true }))
      .not.toThrow();
  });
});

describe("historical rate backup schema", () => {
  const catalog = [
    "247; 1259 19304 TABLE public historical_rate_repair_approvals postgres",
    "248; 1259 19305 TABLE public historical_rate_repair_runs postgres",
    "249; 1259 19306 TABLE public financial_correction_agent_reviews postgres",
    "347; 0 19304 TABLE DATA public historical_rate_repair_approvals postgres",
    "348; 0 19305 TABLE DATA public historical_rate_repair_runs postgres",
    "349; 0 19306 TABLE DATA public financial_correction_agent_reviews postgres",
  ].join("\n");

  it("requires historical and agent review tables in the restore catalog", () => {
    expect(historicalRateAuditTablesInCatalog(catalog)).toBe(true);
    expect(historicalRateAuditTablesInCatalog(catalog.split("\n")[0])).toBe(false);
    expect(historicalRateAuditTablesInCatalog(catalog.replace("TABLE public", "TABLE DATA public")))
      .toBe(false);
    expect(historicalRateAuditTablesInCatalog(catalog.replace(
      /349;[^\n]*financial_correction_agent_reviews[^\n]*/, ""))).toBe(false);
  });

  it("rejects a schema-only dump even when audit tables exist", () => {
    expect(historicalRateDataInCatalog(catalog)).toBe(false);
    const sources = ["loans", "loan_balances", "payments", "loan_waivers", "rate_change_requests",
      "transactions", "transaction_categories", "audit_log"];
    const data = [...sources,
      "historical_rate_repair_approvals", "historical_rate_repair_runs",
      "financial_correction_agent_reviews"]
      .flatMap((name, index) => [
        `${200 + index}; 1259 ${400 + index} TABLE public ${name} postgres`,
        `${300 + index}; 0 ${400 + index} TABLE DATA public ${name} postgres`,
      ]);
    const full = `${catalog}\n${data.join("\n")}`;
    expect(historicalRateDataInCatalog(full)).toBe(true);
    for (const source of sources) {
      expect(historicalRateDataInCatalog(full.replace(
        new RegExp(`^\\d+;[^\\n]*TABLE DATA public ${source} postgres$`, "m"), "")))
        .toBe(false);
      expect(historicalRateDataInCatalog(full.replace(
        new RegExp(`^\\d+;[^\\n]*TABLE public ${source} postgres$`, "m"), "")))
        .toBe(false);
    }
  });

  it("rejects a backup manifest that predates the historical-rate audit tables", () => {
    expect(() => requireHistoricalRateAuditTablesInDump({})).toThrow(/historical.*audit tables/i);
    expect(() => requireHistoricalRateAuditTablesInDump({
      historicalRateAuditTablesInDump: false,
    })).toThrow(/historical.*audit tables/i);
    expect(() => requireHistoricalRateAuditTablesInDump({
      historicalRateAuditTablesInDump: true,
    })).not.toThrow();
  });
});
