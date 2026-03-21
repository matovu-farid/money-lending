import { Effect } from "effect"
import Link from "next/link"
import { listCreditors, getSystemCapital } from "@/services/creditor.service"
import { buttonVariants } from "@/components/ui/button"
import { KpiCard } from "@/components/dashboard/kpi-card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { Landmark, TrendingUp, CreditCard, DollarSign } from "lucide-react"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

export default async function CreditorsPage() {
  const [creditors, capital] = await Promise.all([
    Effect.runPromise(listCreditors()),
    Effect.runPromise(getSystemCapital()),
  ])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Creditors</h1>
        <Link href="/creditors/new" className={cn(buttonVariants())}>
          Add Creditor
        </Link>
      </div>

      {/* System Capital KPIs — CRED-06 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <Link href="/creditors/new" className={cn(buttonVariants())}>
            Add Creditor
          </Link>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Date Added</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creditors.map((creditor) => (
              <TableRow key={creditor.id}>
                <TableCell className="font-medium">{creditor.name}</TableCell>
                <TableCell>{creditor.contact}</TableCell>
                <TableCell>{creditor.address}</TableCell>
                <TableCell>
                  {new Date(creditor.createdAt).toLocaleDateString("en-UG")}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/creditors/${creditor.id}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
