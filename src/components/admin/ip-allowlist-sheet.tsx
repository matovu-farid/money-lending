"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  removeAllowlistEntryAction,
  clearAllowlistAction,
} from "@/actions/ip-allowlist.actions"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/utils"

interface AllowlistEntry {
  id: string
  ip: string
  lastSeenAt: string
}

interface AdminQueue {
  userId: string
  name: string
  email: string
  role: string
  ips: AllowlistEntry[]
}

interface BlockEntry {
  id: string
  userName: string
  userEmail: string
  ip: string
  attemptedAt: string
  path: string | null
}

interface State {
  enabled: boolean
  queues: AdminQueue[]
  recentBlocks: BlockEntry[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: State | undefined
}

export function IpAllowlistSheet({ open, onOpenChange, state }: Props) {
  const qc = useQueryClient()
  const [tab, setTab] = useState("trusted")

  const removeMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await removeAllowlistEntryAction({ entryId })
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
    onSuccess: () => {
      toast.success("IP removed")
      qc.invalidateQueries({ queryKey: ["ip-allowlist", "state"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await clearAllowlistAction()
      if ("error" in res) throw new Error(res.error)
      return res.data
    },
    onSuccess: () => {
      toast.success("All IPs cleared")
      qc.invalidateQueries({ queryKey: ["ip-allowlist", "state"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto" data-testid="ip-allowlist-sheet">
        <SheetHeader>
          <SheetTitle>IP allowlist</SheetTitle>
          <SheetDescription>
            Trusted IPs (one queue per admin), recent blocks, and emergency reset.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-4 px-4">
          <TabsList>
            <TabsTrigger value="trusted" data-testid="tab-trusted">Trusted IPs</TabsTrigger>
            <TabsTrigger value="blocks" data-testid="tab-blocks">Recent blocks</TabsTrigger>
            <TabsTrigger value="danger" data-testid="tab-danger">Reset</TabsTrigger>
          </TabsList>

          <TabsContent value="trusted" className="mt-4">
            {!state || state.queues.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No trusted IPs yet. Admins will populate the allowlist as they log in.
              </p>
            ) : (
              state.queues.map((q) => (
                <div key={q.userId} className="mb-6">
                  <h3 className="font-semibold text-sm">
                    {q.name}{" "}
                    <span className="text-muted-foreground font-normal">— {q.email}</span>
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP</TableHead>
                        <TableHead>Last seen</TableHead>
                        <TableHead className="w-24"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {q.ips.map((entry) => (
                        <TableRow key={entry.id} data-testid="allowlist-row">
                          <TableCell className="font-mono">{entry.ip}</TableCell>
                          <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                            {formatDate(entry.lastSeenAt)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMutation.mutate(entry.id)}
                              disabled={removeMutation.isPending}
                              data-testid={`remove-${entry.id}`}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="blocks" className="mt-4">
            {!state || state.recentBlocks.length === 0 ? (
              <p className="text-muted-foreground text-sm">No recent blocks.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.recentBlocks.map((b) => (
                    <TableRow key={b.id} data-testid="block-row">
                      <TableCell className="text-sm">
                        <div>{b.userName}</div>
                        <div className="text-muted-foreground text-xs">{b.userEmail}</div>
                      </TableCell>
                      <TableCell className="font-mono">{b.ip}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.path ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                        {formatDate(b.attemptedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="danger" className="mt-4">
            <div className="space-y-3">
              <p className="text-sm">
                Wipe the entire allowlist. Lower-role users will be blocked until
                an admin logs in again from a trusted location.
              </p>
              <Dialog>
                <DialogTrigger
                  render={
                    <Button variant="destructive" data-testid="clear-all-button">
                      Clear all trusted IPs
                    </Button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Wipe allowlist?</DialogTitle>
                    <DialogDescription>
                      All admins lose their trusted IPs. Lower-role users will be
                      locked out until an admin signs in.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline">Cancel</Button>} />
                    <DialogClose
                      render={
                        <Button
                          variant="destructive"
                          data-testid="clear-all-confirm"
                          onClick={() => clearMutation.mutate()}
                          disabled={clearMutation.isPending}
                        >
                          Wipe
                        </Button>
                      }
                    />
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
