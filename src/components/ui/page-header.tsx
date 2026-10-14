import { cn } from "@/lib/utils"
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb"

interface PageHeaderProps {
  title: string
  subtitle?: string | React.ReactNode
  breadcrumbs?: BreadcrumbItem[]
  children?: React.ReactNode
  className?: string
  headingAs?: "h1" | "h2"
}

export function PageHeader({ title, subtitle, breadcrumbs, children, className, headingAs: Heading = "h1" }: PageHeaderProps) {
  if (children) {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          className,
        )}
      >
        <div className="min-w-0">
          {breadcrumbs && <Breadcrumb items={breadcrumbs} />}
          <Heading className="text-2xl font-bold tracking-tight">{title}</Heading>
          {subtitle && (
            typeof subtitle === "string" ? (
              <p className="text-sm text-muted-foreground mt-1">
                {subtitle}
              </p>
            ) : (
              subtitle
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {breadcrumbs && <Breadcrumb items={breadcrumbs} />}
      <Heading className="text-2xl font-bold tracking-tight">{title}</Heading>
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
