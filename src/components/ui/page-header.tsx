import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  subtitle?: string | React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  if (children) {
    return (
      <div className={cn("flex items-center justify-between", className)}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            typeof subtitle === "string" ? (
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                {subtitle}
              </p>
            ) : (
              subtitle
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && (
        typeof subtitle === "string" ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
            {subtitle}
          </p>
        ) : (
          subtitle
        )
      )}
    </div>
  )
}
