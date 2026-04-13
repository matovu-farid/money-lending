import type { InferSelectModel } from "drizzle-orm"
import type { auditLog } from "@/lib/db/schema/audit"

export type AuditLogEntry = InferSelectModel<typeof auditLog>
