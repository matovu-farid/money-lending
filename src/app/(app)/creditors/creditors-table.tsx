"use client"

import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { ButtonLink } from "@/components/ui/button-link"
import { formatDate } from "@/lib/utils"

type Creditor = {
  id: string
  name: string
  contact: string
  address: string
  createdAt: Date
  updatedAt: Date
}

const creditorColumns: Column<Creditor>[] = [
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

export function CreditorsTable({ creditors }: { creditors: Creditor[] }) {
  return (
    <ResponsiveTable
      columns={creditorColumns}
      rows={creditors}
      getRowKey={(c) => c.id}
      getRowProps={(_c) => ({ "data-testid": "data-row" })}
    />
  )
}
