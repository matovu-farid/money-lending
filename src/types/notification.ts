import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { notifications } from "@/lib/db/schema/notifications"

export type Notification = InferSelectModel<typeof notifications>
export type NewNotification = InferInsertModel<typeof notifications>
