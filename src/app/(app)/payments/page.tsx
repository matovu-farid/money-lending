import { listPaymentsAction } from "@/actions/payment.actions"
import { PaymentsClient } from "./PaymentsClient"
import type { ListPaymentsInput } from "@/types"

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const tab = (params.tab ?? "list") as "list" | "daily"
  const page = Number(params.page ?? 1)
  const filters: ListPaymentsInput = {
    page,
    pageSize: 25,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    amountMin: params.amountMin,
    amountMax: params.amountMax,
    customerName: params.customerName,
  }
  const result = await listPaymentsAction(filters)
  const initialData = ("data" in result && result.data) ? result.data : { rows: [], total: 0 }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PaymentsClient
        initialData={initialData}
        initialPage={page}
        initialFilters={filters}
        initialTab={tab}
      />
    </div>
  )
}
