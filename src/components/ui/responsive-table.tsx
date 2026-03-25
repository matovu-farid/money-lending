"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  primary?: boolean
  hideInCard?: boolean
  align?: "left" | "right"
  cardLabel?: string
}

export type ResponsiveTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  getRowProps?: (row: T) => React.HTMLAttributes<HTMLElement>
  emptyState?: React.ReactNode
}

export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  getRowProps,
  emptyState,
}: ResponsiveTableProps<T>) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>

  const primaryCol = columns.find((c) => c.primary) ?? columns[0]
  const actionsCol = columns.find((c) => c.key === "actions")

  return (
    <>
      {/* Desktop: standard table — hidden below md breakpoint */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={col.align === "right" ? "text-right" : undefined}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowProps = getRowProps?.(row) ?? {}
              return (
                <TableRow key={getRowKey(row)} {...rowProps}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={col.align === "right" ? "text-right" : undefined}
                    >
                      {col.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards — hidden at md+ breakpoint */}
      <div className="md:hidden space-y-2">
        {rows.map((row) => {
          const rowProps = getRowProps?.(row) ?? {}
          const { className: rowClassName, ...restRowProps } = rowProps

          const detailCols = columns.filter(
            (c) => !c.hideInCard && c.key !== primaryCol.key && c.key !== "actions"
          )

          return (
            <div
              key={getRowKey(row)}
              data-testid="data-row"
              className={cn(
                "rounded-lg border bg-card p-4 space-y-2",
                restRowProps.onClick
                  ? "cursor-pointer hover:bg-muted/50 transition-colors"
                  : undefined,
                rowClassName
              )}
              {...restRowProps}
            >
              {/* Primary field row — with actions if available */}
              {actionsCol ? (
                <div className="flex justify-between items-center">
                  <div className="flex-1 text-sm font-semibold">
                    {primaryCol.render(row)}
                  </div>
                  <div>{actionsCol.render(row)}</div>
                </div>
              ) : (
                <div className="text-sm font-semibold">{primaryCol.render(row)}</div>
              )}

              {/* Detail grid */}
              {detailCols.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {detailCols.map((col) => (
                    <React.Fragment key={col.key}>
                      <dt className="text-muted-foreground">
                        {col.cardLabel ?? col.header}
                      </dt>
                      <dd
                        className={
                          col.align === "right"
                            ? "text-right font-mono tabular-nums"
                            : undefined
                        }
                      >
                        {col.render(row)}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
