"use client"

import { Info, Lock } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/types"

const ROLE_LABELS: Record<UserRole, string> = {
  unassigned: "Unassigned",
  loanOfficer: "Loan Officer",
  supervisor: "Supervisor",
  admin: "Admin",
  superAdmin: "Super Admin",
}

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role]
}

/** Formats "admin" as "Admin or higher" */
function roleOrHigher(role: UserRole): string {
  if (role === "superAdmin") return ROLE_LABELS.superAdmin
  return `${ROLE_LABELS[role]} or higher`
}

interface PermissionInfoProps {
  /** Minimum role required for this action */
  requiredRole: UserRole
  /** Short description of what this action does */
  action: string
  /** Extra detail shown in the popover body */
  detail?: string
  className?: string
  /** Use lock icon instead of info icon (for denied states) */
  locked?: boolean
}

/**
 * A small info/lock icon with a popover explaining who can perform an action.
 * Use next to any permission-gated field, button, or section heading.
 */
export function PermissionInfo({
  requiredRole,
  action,
  detail,
  className,
  locked,
}: PermissionInfoProps) {
  const Icon = locked ? Lock : Info

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center justify-center cursor-help transition-colors",
          locked
            ? "text-muted-foreground/60 hover:text-muted-foreground"
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
        aria-label={`Permission: ${action}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        side="bottom"
        align="start"
      >
        <p className="text-xs font-semibold mb-1">{action}</p>
        <p className="text-xs text-muted-foreground">
          Requires: <span className="font-medium text-foreground">{roleOrHigher(requiredRole)}</span>
        </p>
        {detail && (
          <p className="text-xs text-muted-foreground mt-1.5">{detail}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
