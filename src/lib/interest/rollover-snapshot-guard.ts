import { dirname, isAbsolute, resolve } from "node:path";

/** A deliberately narrow backup location that exists on both supported hosts. */
export const correctionTempDirectory = process.platform === "darwin" ? "/private/tmp" : "/tmp";

/** The backup must use the direct endpoint of the same database as the app. */
export function validateCorrectionDatabaseEndpoints(
  primaryText: string | undefined,
  backupText: string | undefined,
): { primary: URL; backup: URL } {
  if (!primaryText) throw new Error("Primary database URL is required");
  const primary = new URL(primaryText);
  const pooled = primary.hostname.includes("-pooler.");
  if (pooled && !backupText) throw new Error("A matching direct endpoint is required for backup");
  const backup = new URL(backupText ?? primaryText);
  const expectedHost = pooled
    ? primary.hostname.replace("-pooler.", ".") : primary.hostname;
  if (![primary.protocol, backup.protocol].every((protocol) =>
      protocol === "postgres:" || protocol === "postgresql:") ||
      backup.hostname !== expectedHost ||
      (backup.port || "5432") !== (primary.port || "5432") ||
      decodeURIComponent(backup.pathname) !== decodeURIComponent(primary.pathname) ||
      decodeURIComponent(backup.username) !== decodeURIComponent(primary.username)) {
    throw new Error("Backup URL points to a different database endpoint");
  }
  return { primary, backup };
}

/** Inspect the restore catalog, not the live database, for schema and data entries. */
function hasTableAndData(catalog: string, table: string): boolean {
  const lines = catalog.split(/\r?\n/);
  return ["TABLE", "TABLE DATA"].every((kind) => lines.some((line) =>
    new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+${kind} public ${table}(?:\\s|$)`)
      .test(line)));
}

export function correctionAuditTablesInCatalog(catalog: string): boolean {
  return ["rollover_correction_runs", "rollover_correction_approvals",
    "financial_correction_agent_reviews"]
    .every((table) => hasTableAndData(catalog, table));
}

export function requireCorrectionAuditTablesInDump(
  manifest: { correctionAuditTablesInDump?: boolean },
): void {
  if (manifest.correctionAuditTablesInDump !== true) {
    throw new Error("Correction backup must contain rollover and agent review audit tables and data");
  }
}

/** Historical paid-rate repair has its own durable approval and run tables. */
export function historicalRateAuditTablesInCatalog(catalog: string): boolean {
  return ["historical_rate_repair_runs", "historical_rate_repair_approvals",
    "financial_correction_agent_reviews"]
    .every((table) => hasTableAndData(catalog, table));
}

/** A schema-only archive is not a recoverable loan-ledger backup. */
export function historicalRateDataInCatalog(catalog: string): boolean {
  return ["loans", "loan_balances", "payments", "loan_waivers", "rate_change_requests",
    "transactions", "transaction_categories", "audit_log",
    "historical_rate_repair_approvals", "historical_rate_repair_runs",
    "financial_correction_agent_reviews"]
    .every((table) => hasTableAndData(catalog, table));
}

export function requireHistoricalRateAuditTablesInDump(
  manifest: { historicalRateAuditTablesInDump?: boolean },
): void {
  if (manifest.historicalRateAuditTablesInDump !== true) {
    throw new Error("Historical rate correction backup must contain repair and agent review audit tables and data");
  }
}

/** Require an exact database identity and a narrowly scoped backup target. */
export function validateRolloverSnapshotTarget(
  urlText: string | undefined,
  expectedHost: string | undefined,
  expectedDatabase: string | undefined,
  outText: string | undefined,
): { url: URL; database: string; out: string } {
  if (!urlText || !expectedHost || !expectedDatabase) {
    throw new Error("Explicit database identity is required");
  }
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new Error("Invalid database URL");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== expectedHost || database !== expectedDatabase) {
    throw new Error("Database identity does not match the requested snapshot target");
  }
  if (!outText || !isAbsolute(outText)) {
    throw new Error(`Snapshot path must be an absolute direct child of ${correctionTempDirectory}`);
  }
  const out = resolve(outText);
  if (dirname(out) !== correctionTempDirectory || !out.endsWith(".dump")) {
    throw new Error(`Snapshot path must be a .dump file directly under ${correctionTempDirectory}`);
  }
  return { url, database, out };
}
