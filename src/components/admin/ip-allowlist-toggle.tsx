"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  getIpAllowlistStateAction,
  setIpAllowlistEnabledAction,
} from "@/actions/ip-allowlist.actions"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { IpAllowlistSheet } from "./ip-allowlist-sheet"

const QUERY_KEY = ["ip-allowlist", "state"]

export function IpAllowlistToggle() {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await getIpAllowlistStateAction()
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await setIpAllowlistEnabledAction({ enabled })
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
    onSuccess: (_, enabled) => {
      toast.success(enabled ? "IP restriction enabled" : "IP restriction disabled")
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const enabled = data?.enabled ?? false

  return (
    <section className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(v: boolean) => toggleMutation.mutate(v)}
            disabled={isLoading || toggleMutation.isPending}
            data-testid="ip-allowlist-toggle"
          />
          <span className="font-medium">Restrict access by IP</span>
        </div>
        <p className="text-sm text-muted-foreground max-w-prose">
          When on, supervisors and loan officers can only sign in from IPs already
          used by an admin (last 100 per admin, deduped). Admins are exempt.
          With an empty allowlist, lower-role users are blocked until any admin logs in.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setSheetOpen(true)}
        data-testid="ip-allowlist-view-button"
      >
        View IP allowlist
      </Button>
      <IpAllowlistSheet open={sheetOpen} onOpenChange={setSheetOpen} state={data} />
    </section>
  )
}
