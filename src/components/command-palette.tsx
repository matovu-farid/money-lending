"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import {
  LayoutDashboard,
  Users,
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  BarChart3,
  UserPlus,
  FilePlus,
  DollarSign,
  FileDown,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface CommandItem {
  label: string
  icon: React.ElementType
  href: string
  keywords?: string[]
}

const navigationItems: CommandItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", keywords: ["home", "overview"] },
  { label: "Customers", icon: Users, href: "/customers", keywords: ["clients", "borrowers"] },
  { label: "Loans", icon: Banknote, href: "/loans", keywords: ["lending", "credit"] },
  { label: "Payments", icon: CreditCard, href: "/payments", keywords: ["collections", "receipts"] },
  { label: "Reports", icon: BarChart3, href: "/reports", keywords: ["analytics", "insights"] },
  { label: "Expenses", icon: Receipt, href: "/expenses", keywords: ["costs", "spending"] },
  { label: "Creditors", icon: Landmark, href: "/creditors", keywords: ["funders", "capital"] },
]

const actionItems: CommandItem[] = [
  { label: "Record Payment", icon: DollarSign, href: "/payments", keywords: ["collect", "receive"] },
  { label: "New Customer", icon: UserPlus, href: "/customers/new", keywords: ["add client", "create borrower"] },
  { label: "New Loan", icon: FilePlus, href: "/loans/new", keywords: ["create loan", "disburse"] },
  { label: "Export Report", icon: FileDown, href: "/reports", keywords: ["download", "csv"] },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const runCommand = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  return (
    <CommandPrimitive.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-[24px]"
      contentClassName={cn(
        "fixed top-[20%] left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2",
        "rounded-lg bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85",
        "shadow-lg border border-border overflow-hidden",
        "sm:max-w-md",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      )}
      loop
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <CommandPrimitive.Input
          placeholder="Search pages and actions..."
          className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          esc
        </kbd>
      </div>

      <CommandPrimitive.List className="max-h-[300px] overflow-y-auto p-1">
        <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
          No results found.
        </CommandPrimitive.Empty>

        <CommandPrimitive.Group
          heading="Navigation"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
        >
          {navigationItems.map((item) => (
            <CommandPrimitive.Item
              key={item.href}
              value={item.label}
              keywords={item.keywords}
              onSelect={() => runCommand(item.href)}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm cursor-pointer select-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
            >
              <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandPrimitive.Item>
          ))}
        </CommandPrimitive.Group>

        <CommandPrimitive.Separator className="my-1 h-px bg-border" alwaysRender />

        <CommandPrimitive.Group
          heading="Actions"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
        >
          {actionItems.map((item) => (
            <CommandPrimitive.Item
              key={`action-${item.label}`}
              value={item.label}
              keywords={item.keywords}
              onSelect={() => runCommand(item.href)}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm cursor-pointer select-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
            >
              <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandPrimitive.Item>
          ))}
        </CommandPrimitive.Group>
      </CommandPrimitive.List>

      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-3">
        <span className="flex items-center gap-1">
          <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px]">&uarr;</kbd>
          <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px]">&darr;</kbd>
          navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px]">&crarr;</kbd>
          select
        </span>
      </div>
    </CommandPrimitive.Dialog>
  )
}

/** Hook to open the palette programmatically */
const openCommandPalette = () => {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
  )
}
const stableRef = { open: openCommandPalette }

export function useCommandPalette() {
  return stableRef
}
