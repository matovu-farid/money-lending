import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface OverdueBadgeProps {
  daysOverdue: number
  className?: string
}

export function OverdueBadge({ daysOverdue, className }: OverdueBadgeProps) {
  let bgClass: string
  let textClass: string
  let label: string

  if (daysOverdue >= 30) {
    bgClass = "bg-red-100"
    textClass = "text-red-800"
    label = `${daysOverdue} days`
  } else if (daysOverdue >= 15) {
    bgClass = "bg-yellow-100"
    textClass = "text-yellow-800"
    label = `${daysOverdue} days`
  } else {
    bgClass = "bg-green-100"
    textClass = "text-green-800"
    label = `${daysOverdue} days`
  }

  return (
    <Badge
      variant="outline"
      className={cn(bgClass, textClass, "border-0", className)}
      aria-label={`${daysOverdue} days overdue`}
    >
      {label}
    </Badge>
  )
}
