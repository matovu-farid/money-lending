"use client"

import { useState, useTransition } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLiveQuery } from "@tanstack/react-db"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { assignRole } from "@/actions/user.actions"
import { delegationCollection, type DelegationRow } from "@/collections"
import { generateClientId } from "@/lib/client-id"
import { Button } from "@/components/ui/button"
import { useAdminUsers } from "@/hooks/use-admin-users"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole } from "@/types"
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


export default function AdminPage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()

  const { has } = usePermissions()
  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const canViewUsers = has("user:list")

  const { data: users = [], isLoading, isFetching } = useAdminUsers(!!session && canViewUsers)

  // Live delegation collection — optimistic insert/delete handled by TanStack DB
  const { data: allDelegations = [] } = useLiveQuery((q) =>
    q.from({ d: delegationCollection }).select(({ d }) => d)
  )
  const activeDelegations = allDelegations.filter((d) => !d.revokedAt)
  const pastDelegations = allDelegations.filter((d) => d.revokedAt)

  const [isDelegating, setIsDelegating] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)

  function handleDelegate(userId: string) {
    try {
      setIsDelegating(true)
      const id = generateClientId()
      delegationCollection.insert({
        id,
        userId,
        userName: null,
        delegatedBy: session?.user?.name ?? "",
        createdAt: new Date(),
        revokedAt: null,
        revokedBy: null,
      })
      toast.success("Delegation created")
      queryClient.invalidateQueries({ queryKey: ["effective-permissions"] })
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
      queryClient.invalidateQueries({ queryKey: ["effective-permissions"] })
    } catch {
      toast.error("Failed to revoke delegation")
    } finally {
      setIsRevoking(false)
    }
  }

  function handleRoleChange(userId: string, newRole: UserRole) {
    startTransition(async () => {
      const result = await assignRole({ userId, role: newRole })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      // Revalidate to get server truth
      queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers.all })
      toast.success(`Role updated to ${newRole}`)
    })
  }

  const loading = canViewUsers ? (isLoading && isFetching) : !session
  if (!session || loading) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

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
                    <TableCell className="font-medium">{d.userName}</TableCell>
                    <TableCell>{d.delegatedBy}</TableCell>
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
                      <TableCell className="font-medium">{d.userName}</TableCell>
                      <TableCell>{d.delegatedBy}</TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                        {formatDate(d.createdAt)} — {d.revokedAt ? formatDate(d.revokedAt) : "—"}
                      </TableCell>
                      <TableCell>{d.revokedBy ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
