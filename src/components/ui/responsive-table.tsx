"use client"

import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
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
  header: React.ReactNode
  render: (row: T) => React.ReactNode
  primary?: boolean
  hideInCard?: boolean
  align?: "left" | "right"
  cardLabel?: string
}

export type RowProps = React.HTMLAttributes<HTMLElement> & { [key: string]: unknown }

export type ResponsiveTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  getRowProps?: (row: T) => RowProps
  emptyState?: React.ReactNode
}

const VIRTUALIZE_THRESHOLD = 50
const ROW_HEIGHT = 48

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
  const shouldVirtualize = rows.length > VIRTUALIZE_THRESHOLD

  return (
    <>
      {/* Desktop: standard table — hidden below md breakpoint */}
      {shouldVirtualize ? (
        <VirtualizedTable
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          getRowProps={getRowProps}
        />
      ) : (
        <div className="hidden md:block max-h-[calc(100vh-12rem)] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={cn("sticky top-0 bg-background z-10", col.align === "right" ? "text-right" : undefined)}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const rowProps = getRowProps?.(row) ?? {}
                const isClickable = !!rowProps.onClick
                return (
                  <TableRow key={getRowKey(row)} {...rowProps}>
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn(
                          col.align === "right" ? "text-right" : undefined,
                          isClickable ? "cursor-pointer" : undefined
                        )}
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
      )}

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

function VirtualizedTable<T>({
  columns,
  rows,
  getRowKey,
  getRowProps,
}: {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  getRowProps?: (row: T) => RowProps
}) {
  const parentRef = React.useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  return (
    <div
      ref={parentRef}
      className="hidden md:block max-h-[calc(100vh-12rem)] overflow-y-auto"
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn("sticky top-0 bg-background z-10", col.align === "right" ? "text-right" : undefined)}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {virtualizer.getVirtualItems().length > 0 && (
            <tr style={{ height: virtualizer.getVirtualItems()[0].start }} />
          )}
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            const rowProps = getRowProps?.(row) ?? {}
            const isClickable = !!rowProps.onClick
            return (
              <TableRow
                key={getRowKey(row)}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                {...rowProps}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      col.align === "right" ? "text-right" : undefined,
                      isClickable ? "cursor-pointer" : undefined
                    )}
                  >
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
          {virtualizer.getVirtualItems().length > 0 && (
            <tr
              style={{
                height:
                  virtualizer.getTotalSize() -
                  (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
              }}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}
