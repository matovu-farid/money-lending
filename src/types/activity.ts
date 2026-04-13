export interface ActivityItem {
  id: string
  actorName: string
  actorRole: string
  action: string
  entityType: string
  entityId: string
  description: string
  href: string | null
  occurredAt: Date
}

export interface GetActivitiesInput {
  actorId?: string
  entityType?: string
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

export interface GetActivitiesResult {
  items: ActivityItem[]
  total: number
}
