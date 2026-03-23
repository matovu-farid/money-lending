"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
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
import { formatDate } from "@/lib/utils"

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


export default function AdminPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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

  function handleRoleChange(userId: string, newRole: UserRole) {
    setUpdatingUserId(userId)
    startTransition(async () => {
      const result = await assignRole({ userId, role: newRole })
      setUpdatingUserId(null)

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      )
      toast.success(`Role updated to ${newRole}`)
      router.refresh()
    })
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
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">System administration</p>
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
              const isUpdating = updatingUserId === user.id

              return (
                <TableRow key={user.id}>
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
                          disabled={isUpdating}
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
                      {isUpdating && <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />}
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
