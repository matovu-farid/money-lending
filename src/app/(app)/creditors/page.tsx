import { Effect, Exit } from "effect"
import { listCreditors, getSystemCapital } from "@/services/creditor.service"
import { ButtonLink } from "@/components/ui/button-link"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { CreditorsTable } from "./creditors-table"
import { Landmark, TrendingUp, CreditCard, DollarSign } from "lucide-react"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

const defaultCapital = {
  totalInvested: "0.00",
  totalInterestAccrued: "0.00",
  totalRepaymentsMade: "0.00",
  totalOutstanding: "0.00",
}

export default async function CreditorsPage() {
  const [creditorsExit, capitalExit] = await Promise.all([
    Effect.runPromiseExit(listCreditors()),
    Effect.runPromiseExit(getSystemCapital()),
  ])

  const creditors = Exit.isSuccess(creditorsExit) ? creditorsExit.value : []
  const capital = Exit.isSuccess(capitalExit) ? capitalExit.value : defaultCapital

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Creditors</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Capital sources and obligations</p>
        </div>
        <ButtonLink href="/creditors/new">
          Add Creditor
        </ButtonLink>
      </div>

      {/* System Capital KPIs — CRED-06 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Invested"
          value={formatUGX(capital.totalInvested)}
          icon={Landmark}
        />
        <KpiCard
          label="Total Interest Accrued"
          value={formatUGX(capital.totalInterestAccrued)}
          icon={TrendingUp}
        />
        <KpiCard
          label="Total Repayments"
          value={formatUGX(capital.totalRepaymentsMade)}
          icon={CreditCard}
        />
        <KpiCard
          label="Total Outstanding"
          value={formatUGX(capital.totalOutstanding)}
          icon={DollarSign}
        />
      </div>

      {creditors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-xl font-medium">No creditors yet</p>
          <p className="text-muted-foreground">
            Register your first creditor to start tracking invested capital.
          </p>
          <ButtonLink href="/creditors/new">
            Add Creditor
          </ButtonLink>
        </div>
      ) : (
        <CreditorsTable creditors={creditors} />
      )}
    </div>
  )
}
