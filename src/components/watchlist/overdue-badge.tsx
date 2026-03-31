import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface OverdueBadgeProps {
  daysOverdue: number
  className?: string
}

export function OverdueBadge({ daysOverdue, className }: OverdueBadgeProps) {
  const severity =
    daysOverdue >= 30
      ? { colorClass: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", prefix: "Critical" }
      : daysOverdue >= 25
        ? { colorClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300", prefix: "At-risk" }
        : { colorClass: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", prefix: "" }

  const label = severity.prefix
    ? `${severity.prefix} · ${daysOverdue}d`
    : `${daysOverdue}d`

  return (
    <Badge
      variant="outline"
      className={cn(severity.colorClass, "border-0", className)}
      aria-label={`${severity.prefix || "Overdue"} — ${daysOverdue} days overdue`}
    >
      {label}
    </Badge>
  )
}
