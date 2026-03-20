"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { authClient, useSession } from "@/lib/auth-client"
import { assignRole } from "@/actions/user.actions"
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

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean | null
  createdAt: Date | string
}

function getRoleOptions(actorRole: UserRole): UserRole[] {
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  return (Object.keys(ROLE_LEVELS) as UserRole[]).filter(
    (role) => ROLE_LEVELS[role] < actorLevel
  )
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("en-UG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export default function AdminPage() {
  const { data: session } = useSession()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null)

  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0

  useEffect(() => {
    if (!session) return

    if (actorLevel < ROLE_LEVELS.admin) {
      setLoading(false)
      return
    }

    authClient.admin.listUsers({ query: { limit: 100 } }).then((result) => {
      if (result.error) {
        toast.error("Failed to load users")
        setLoading(false)
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawUsers = (result.data as any)?.users ?? []
      setUsers(rawUsers as AdminUser[])
      setLoading(false)
    })
  }, [session, actorLevel])

  async function handleRoleChange(userId: string, newRole: UserRole) {
    setRoleUpdating(userId)
    const result = await assignRole({ userId, role: newRole })
    setRoleUpdating(null)

    if ("error" in result) {
      toast.error(result.error)
      return
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    )
    toast.success(`Role updated to ${newRole}`)
  }

  if (!session || loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (actorLevel < ROLE_LEVELS.admin) {
    return (
      <div className="p-6">
        <p className="text-destructive font-medium">Access denied.</p>
        <p className="text-muted-foreground text-sm mt-1">
          You need Admin or Super Admin permissions to view this page.
        </p>
      </div>
    )
  }

  const roleOptions = getRoleOptions(actorRole)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-muted-foreground text-sm mt-0.5">User management</p>
        </div>
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground">No users found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const userRole = (user.role ?? "unassigned") as UserRole
              const userLevel = ROLE_LEVELS[userRole] ?? 0
              // Can only assign roles to users with a level below the actor's level
              const canChangeRole = userLevel < actorLevel && roleOptions.length > 0
              const isUpdating = roleUpdating === user.id

              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {canChangeRole ? (
                      <Select
                        value={userRole}
                        onValueChange={(val: string | null) =>
                          val && handleRoleChange(user.id, val as UserRole)
                        }
                        disabled={isUpdating}
                      >
                        <SelectTrigger className="w-36" size="sm">
                          <SelectValue />
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
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Badge variant="destructive">Banned</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
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
