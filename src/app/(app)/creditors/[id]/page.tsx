"use client"

import { use } from "react"
import { CreditorProfileClient } from "./CreditorProfileClient"
import { usePermissions } from "@/hooks/use-permissions"
import { PermissionInfo } from "@/components/ui/permission-info"

interface Props {
  params: Promise<{ id: string }>
}

export default function CreditorProfilePage({ params }: Props) {
  const { id } = use(params)
  const { has } = usePermissions()

  if (!has("creditor:read")) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="admin" action="View creditor profile" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Admin or higher permissions to view creditor profiles.
        </p>
      </div>
    )
  }

  return <CreditorProfileClient creditorId={id} />
}
