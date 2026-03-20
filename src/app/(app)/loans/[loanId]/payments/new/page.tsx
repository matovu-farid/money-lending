import { RecordPaymentForm } from "./record-payment-form"

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params
  return <RecordPaymentForm loanId={loanId} />
}
