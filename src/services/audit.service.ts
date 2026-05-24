import { auditLog } from "@/lib/db/schema/audit"
import type { db } from "@/lib/db"

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
/**
 * The minimal surface of a drizzle transaction (or the real `db` handle) that
 * `writeAuditLog` actually uses. Structural typing keeps this compatible with
 * both real Drizzle txs and unit-test mocks without falling back to `any`.
 */
type AuditLogWriter = Pick<DrizzleTx, "insert">

type AuditEntry = {
  actorId: string
  action: string
  entityType: string
  entityId: string
  beforeValue: unknown | null
  afterValue: unknown | null
}

export async function writeAuditLog(tx: AuditLogWriter, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeValue: entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
    afterValue: entry.afterValue ? JSON.stringify(entry.afterValue) : null,
  })
}
