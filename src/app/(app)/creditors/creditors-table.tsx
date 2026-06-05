"use client"

import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { ButtonLink } from "@/components/ui/button-link"
import { formatDate } from "@/lib/utils"
import { CurrencyCell } from "@/components/ui/currency-cell"

type Creditor = {
  id: string
  name: string
  contact: string
  address: string
  createdAt: Date
  updatedAt: Date
}

interface Props {
  creditors: Creditor[]
  monthlyDue: Record<string, string>
}

function getColumns(monthlyDue: Record<string, string>): Column<Creditor>[] {
  return [
    {
      key: "name",
      header: "Name",
      primary: true,
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: "contact",
      header: "Contact",
      render: (c) => c.contact,
    },
    {
      key: "address",
      header: "Address",
      render: (c) => c.address,
    },
    {
      key: "monthlyInterestDue",
      header: "Monthly Interest Due",
      cardLabel: "Interest Due",
      render: (c) => <CurrencyCell amount={monthlyDue[c.id] ?? "0"} />,
    },
    {
      key: "createdAt",
      header: "Date Added",
      cardLabel: "Added",
      render: (c) => <span className="font-mono tabular-nums">{formatDate(c.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      hideInCard: false,
      render: (c) => (
        <ButtonLink href={`/creditors/${c.id}`} variant="outline" size="sm">
          View
        </ButtonLink>
      ),
    },
  ]
}

export function CreditorsTable({ creditors, monthlyDue }: Props) {
  return (
    <ResponsiveTable
      columns={getColumns(monthlyDue)}
      rows={creditors}
      getRowKey={(c) => c.id}
      getRowProps={(_c) => ({ "data-testid": "data-row" })}
    />
  )
}
