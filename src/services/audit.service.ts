import { auditLog } from "@/lib/db/schema/audit"

type AuditEntry = {
  actorId: string
  action: string
  entityType: string
  entityId: string
  beforeValue: unknown | null
  afterValue: unknown | null
}

export async function writeAuditLog(tx: any, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeValue: entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
    afterValue: entry.afterValue ? JSON.stringify(entry.afterValue) : null,
  })
}
