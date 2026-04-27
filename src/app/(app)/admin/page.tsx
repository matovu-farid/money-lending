"use client"

import { useState, useMemo, Suspense } from "react"
import { useLiveSuspenseQuery, useLiveQuery } from "@tanstack/react-db"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { delegationCollection } from "@/collections/delegations"
import { adminUserCollection } from "@/collections/admin-users"
import { invitationCollection } from "@/collections/invitations"
import { getUserNameMapCollection } from "@/collections/loan-extras"
import { resendInviteAction } from "@/actions/invitation.actions"
import { generateClientId } from "@/lib/client-id"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useAdminUsers } from "@/hooks/use-admin-users"
import { ROLE_LEVELS, type UserRole, type Permission } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { InfoPopover } from "@/components/ui/info-popover"
import { PermissionInfo } from "@/components/ui/permission-info"
import { PageHeader } from "@/components/ui/page-header"
import { formatDate } from "@/lib/utils"

function getRoleOptions(actorRole: UserRole): UserRole[] {
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  return (Object.keys(ROLE_LEVELS) as UserRole[]).filter(
    (role) => ROLE_LEVELS[role] < actorLevel
  )
}


function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
      <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}

export default function AdminPage() {
  const { data: session } = useSession()
  const { has } = usePermissions()
  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0

  if (!has("user:list")) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="admin" action="Manage user roles" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Admin or Super Admin permissions to view this page.
        </p>
      </div>
    )
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <AdminContent has={has} session={session} actorRole={actorRole} actorLevel={actorLevel} />
    </Suspense>
  )
}

interface AdminContentProps {
  has: (p: Permission) => boolean
  session: ReturnType<typeof useSession>["data"]
  actorRole: UserRole
  actorLevel: number
}

function AdminContent({ has, session, actorRole, actorLevel }: AdminContentProps) {
  const { data: users = [] } = useAdminUsers()

  // Live delegation collection — optimistic insert/delete handled by TanStack DB
  const { data: allDelegations = [] } = useLiveSuspenseQuery((q) =>
    q.from({ d: delegationCollection }).select(({ d }) => d)
  )
  const activeDelegations = allDelegations.filter((d) => !d.revokedAt)
  const pastDelegations = allDelegations.filter((d) => d.revokedAt)

  // Resolve user IDs from delegations to display names
  const delegationUserIds = useMemo(() => {
    const ids = new Set<string>()
    for (const d of allDelegations) {
      ids.add(d.userId)
      ids.add(d.delegatedBy)
      if (d.revokedBy) ids.add(d.revokedBy)
    }
    return [...ids]
  }, [allDelegations])

  const delegationNameMapColl = getUserNameMapCollection(delegationUserIds)
  const { data: delegationNameRows } = useLiveQuery(
    (q) => q.from({ u: delegationNameMapColl }).select(({ u }) => u),
    [delegationUserIds.join(",")]
  )
  const delegationNameMap: Record<string, string> = delegationNameRows?.[0]?.map ?? {}

  const [isDelegating, setIsDelegating] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)

  function handleDelegate(userId: string) {
    try {
      setIsDelegating(true)
      const id = generateClientId()
      delegationCollection.insert({
        id,
        userId,
        delegatedBy: session?.user?.id ?? "",
        createdAt: new Date().toISOString(),
        revokedAt: null,
        revokedBy: null,
      })
      toast.success("Delegation created")
    } catch {
      toast.error("Failed to create delegation")
    } finally {
      setIsDelegating(false)
    }
  }

  function handleRevoke(delegationId: string) {
    try {
      setIsRevoking(true)
      delegationCollection.delete(delegationId)
      toast.success("Delegation revoked")
    } catch {
      toast.error("Failed to revoke delegation")
    } finally {
      setIsRevoking(false)
    }
  }

  function handleRoleChange(userId: string, newRole: UserRole) {
    adminUserCollection.update(userId, (draft) => {
      draft.role = newRole
    })
    toast.success(`Role updated to ${newRole}`)
  }

  const roleOptions = getRoleOptions(actorRole)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader title="Admin" subtitle="System administration" />

      {users.length === 0 ? (
        <p className="text-muted-foreground">No users found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1">
                  Role
                  <InfoPopover>
                    <p className="font-semibold text-sm mb-1">User Roles</p>
                    <div className="text-xs text-muted-foreground space-y-1.5">
                      <p><strong>Super Admin</strong> — Full system access. Can manage all users, change any role, and access all settings. Only the first registered user gets this role automatically.</p>
                      <p><strong>Admin</strong> — Can manage loans, customers, payments, and assign roles up to supervisor. Can access admin settings.</p>
                      <p><strong>Supervisor</strong> — Same as Loan Officer plus can assign loan officers and approve/reject rate change requests within their threshold.</p>
                      <p><strong>Loan Officer</strong> — Can create customers, issue loans, and record payments. Cannot access admin settings or change roles.</p>
                      <p><strong>Unassigned</strong> — New users start here. Cannot perform any actions until a role is assigned by an admin.</p>
                    </div>
                  </InfoPopover>
                </span>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const userRole = (user.role ?? "unassigned") as UserRole
              const userLevel = ROLE_LEVELS[userRole] ?? 0
              // Can only assign roles to users with a level below the actor's level
              const canChangeRole = userLevel < actorLevel && roleOptions.length > 0

              return (
                <TableRow key={user.id} data-testid="data-row">
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {canChangeRole ? (
                        <Select
                          value={userRole}
                          onValueChange={(val: string | null) =>
                            val && handleRoleChange(user.id, val as UserRole)
                          }
                        >
                          <SelectTrigger className="w-36" size="sm">
                            <SelectValue>
                              {userRole === "loanOfficer"
                                ? "Loan Officer"
                                : userRole === "superAdmin"
                                  ? "Super Admin"
                                  : userRole.charAt(0).toUpperCase() + userRole.slice(1)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role === "loanOfficer"
                                  ? "Loan Officer"
                                  : role === "superAdmin"
                                    ? "Super Admin"
                                    : role.charAt(0).toUpperCase() + role.slice(1)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">
                          {userRole === "loanOfficer"
                            ? "Loan Officer"
                            : userRole === "superAdmin"
                              ? "Super Admin"
                              : userRole.charAt(0).toUpperCase() + userRole.slice(1)}
                        </span>
                      )}
                      {user.role === "supervisor" && has("delegation:create") && !activeDelegations.some((d) => d.userId === user.id) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelegate(user.id)}
                          disabled={isDelegating}
                          className="ml-2"
                        >
                          Delegate
                        </Button>
                      )}
                      {user.role === "supervisor" && activeDelegations.some((d) => d.userId === user.id) && (
                        <Badge variant="default" className="ml-2">Managing Supervisor</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Badge variant="destructive">Banned</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                    {formatDate(user.createdAt)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {has("delegation:read") && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Active Delegations</h2>
          {activeDelegations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active delegations.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supervisor</TableHead>
                  <TableHead>Delegated By</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeDelegations.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{delegationNameMap[d.userId] ?? d.userId}</TableCell>
                    <TableCell>{delegationNameMap[d.delegatedBy] ?? d.delegatedBy}</TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                      {formatDate(d.createdAt)}
                    </TableCell>
                    <TableCell>
                      {has("delegation:revoke") && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRevoke(d.id)}
                          disabled={isRevoking}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {pastDelegations.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Delegation History ({pastDelegations.length})
              </summary>
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Supervisor</TableHead>
                    <TableHead>Delegated By</TableHead>
                    <TableHead>Active Period</TableHead>
                    <TableHead>Revoked By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pastDelegations.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{delegationNameMap[d.userId] ?? d.userId}</TableCell>
                      <TableCell>{delegationNameMap[d.delegatedBy] ?? d.delegatedBy}</TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                        {formatDate(d.createdAt)} — {d.revokedAt ? formatDate(d.revokedAt) : "—"}
                      </TableCell>
                      <TableCell>{d.revokedBy ? (delegationNameMap[d.revokedBy] ?? d.revokedBy) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          )}
        </section>
      )}

      {has("user:invite") && (
        <InvitationsSection actorRole={actorRole} session={session} />
      )}
    </div>
  )
}

function InvitationsSection({
  actorRole,
  session,
}: {
  actorRole: UserRole
  session: ReturnType<typeof useSession>["data"]
}) {
  const [email, setEmail] = useState("")
  const [inviteeName, setInviteeName] = useState("")
  const [inviteRole, setInviteRole] = useState<UserRole | "">("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [isSending, setIsSending] = useState(false)

  const roleOptions = getRoleOptions(actorRole)

  const { data: allInvitations = [] } = useLiveSuspenseQuery((q) =>
    q.from({ i: invitationCollection }).select(({ i }) => i)
  )

  // Resolve inviter user IDs to display names
  const inviterUserIds = useMemo(() => {
    return [...new Set(allInvitations.map((inv) => inv.invitedBy))]
  }, [allInvitations])

  const inviterNameMapColl = getUserNameMapCollection(inviterUserIds)
  const { data: inviterNameRows } = useLiveQuery(
    (q) => q.from({ u: inviterNameMapColl }).select(({ u }) => u),
    [inviterUserIds.join(",")]
  )
  const inviterNameMap: Record<string, string> = inviterNameRows?.[0]?.map ?? {}

  const filteredInvitations =
    statusFilter === "all"
      ? allInvitations
      : allInvitations.filter((inv) => inv.status === statusFilter)

  async function handleSendInvite(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim() || !inviteeName.trim() || !inviteRole) return

    setIsSending(true)
    try {
      const tx = invitationCollection.insert({
        id: crypto.randomUUID(),
        email: email.trim().toLowerCase(),
        name: inviteeName.trim(),
        role: inviteRole,
        status: "pending",
        invitedBy: session?.user?.id ?? "",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        acceptedAt: null,
      })
      await tx.isPersisted.promise
      toast.success(`Invitation sent to ${email}`)
      setEmail("")
      setInviteeName("")
      setInviteRole("")
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send invitation")
    } finally {
      setIsSending(false)
    }
  }

  async function handleRevoke(invitationId: string) {
    try {
      const tx = invitationCollection.delete(invitationId)
      await tx.isPersisted.promise
      toast.success("Invitation revoked")
    } catch (err: any) {
      toast.error(err.message ?? "Failed to revoke invitation")
    }
  }

  async function handleResend(invitationId: string) {
    const result = await resendInviteAction({ invitationId })
    if ("error" in result) {
      toast.error(result.error)
    } else {
      toast.success("Invitation resent")
    }
  }

  const STATUS_BADGES: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "default",
    accepted: "secondary",
    expired: "destructive",
    revoked: "outline",
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Invitations</h2>

      <form onSubmit={handleSendInvite} className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="invite-name">Name</Label>
          <Input
            id="invite-name"
            value={inviteeName}
            onChange={(e) => setInviteeName(e.target.value)}
            placeholder="John Doe"
            disabled={isSending}
          />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="john@example.com"
            disabled={isSending}
          />
        </div>
        <div className="space-y-1.5 w-40">
          <Label>Role</Label>
          <Select
            value={inviteRole}
            onValueChange={(val: string | null) => val && setInviteRole(val as UserRole)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role} value={role}>
                  {role === "loanOfficer"
                    ? "Loan Officer"
                    : role === "superAdmin"
                      ? "Super Admin"
                      : role.charAt(0).toUpperCase() + role.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={isSending || !email.trim() || !inviteeName.trim() || !inviteRole}>
          Send Invite
        </Button>
      </form>

      <div className="flex gap-2">
        {["all", "pending", "accepted", "expired", "revoked"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {filteredInvitations.length === 0 ? (
        <p className="text-muted-foreground text-sm">No invitations found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent By</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvitations.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-medium">{inv.name}</TableCell>
                <TableCell>{inv.email}</TableCell>
                <TableCell>
                  {inv.role === "loanOfficer"
                    ? "Loan Officer"
                    : inv.role === "superAdmin"
                      ? "Super Admin"
                      : inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGES[inv.status] ?? "outline"}>
                    {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>{inviterNameMap[inv.invitedBy] ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                  {formatDate(inv.createdAt)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                  {formatDate(inv.expiresAt)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    {inv.status === "pending" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResend(inv.id)}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRevoke(inv.id)}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                    {inv.status === "expired" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResend(inv.id)}
                      >
                        Resend
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
