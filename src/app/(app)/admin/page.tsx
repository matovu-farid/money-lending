"use client"

import { useTransition } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { assignRole } from "@/actions/user.actions"
import { useAdminUsers, type AdminUser } from "@/hooks/use-admin-users"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole } from "@/types"
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

  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const isAdmin = actorLevel >= ROLE_LEVELS.admin

  const { data: users = [], isLoading, isFetching } = useAdminUsers(!!session && isAdmin)

  function handleRoleChange(userId: string, newRole: UserRole) {
    startTransition(async () => {
      // Snapshot previous state for rollback
      const previous = queryClient.getQueryData<AdminUser[]>(queryKeys.adminUsers.list())

      // Optimistically update the user's role in cache
      queryClient.setQueryData<AdminUser[]>(queryKeys.adminUsers.list(), (old) =>
        old?.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      )

      const result = await assignRole({ userId, role: newRole })

      if ("error" in result) {
        // Rollback on error
        queryClient.setQueryData(queryKeys.adminUsers.list(), previous)
        toast.error(result.error)
        return
      }

      // Revalidate to get server truth
      queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers.all })
      toast.success(`Role updated to ${newRole}`)
    })
  }

  const loading = isAdmin ? (isLoading && isFetching) : !session
  if (!session || loading) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (actorLevel < ROLE_LEVELS.admin) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive font-medium">Access denied.</p>
        <p className="text-muted-foreground text-sm mt-1">
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
                      <p><strong>Admin</strong> — Can manage loans, customers, payments, and assign roles to users below their level. Cannot modify Super Admin accounts.</p>
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
                                : userRole.charAt(0).toUpperCase() + userRole.slice(1)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role === "loanOfficer"
                                  ? "Loan Officer"
                                  : role.charAt(0).toUpperCase() + role.slice(1)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">
                          {userRole === "loanOfficer"
                            ? "Loan Officer"
                            : userRole.charAt(0).toUpperCase() + userRole.slice(1)}
                        </span>
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
    </div>
  )
}
