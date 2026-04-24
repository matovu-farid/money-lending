# Change Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to change their display name from the sidebar via a DrawerDialog.

**Architecture:** Clicking the user name/avatar area in the sidebar opens a DrawerDialog with a single name input. Uses better-auth's built-in `authClient.updateUser({ name })` — no custom server action needed. Session auto-refreshes after update.

**Tech Stack:** better-auth `updateUser`, DrawerDialog (Dialog desktop / Drawer mobile), sonner toast

---

### Task 1: Create ChangeNameDialog component

**Files:**
- Create: `src/components/layout/change-name-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"

interface ChangeNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
}

export function ChangeNameDialog({ open, onOpenChange, currentName }: ChangeNameDialogProps) {
  const [name, setName] = useState(currentName)
  const [isPending, setIsPending] = useState(false)

  function handleOpen(nextOpen: boolean) {
    if (!nextOpen) {
      setName(currentName)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) return

    setIsPending(true)
    const { error } = await authClient.updateUser({ name: trimmed })
    setIsPending(false)

    if (error) {
      toast.error("Failed to update name")
      return
    }

    toast.success("Name updated")
    onOpenChange(false)
  }

  return (
    <DrawerDialog open={open} onOpenChange={handleOpen}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Change Name</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="userName">Name</Label>
            <Input
              id="userName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) handleSubmit()
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `change-name-dialog.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/change-name-dialog.tsx
git commit -m "feat: add ChangeNameDialog component"
```

---

### Task 2: Wire ChangeNameDialog into the sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add imports and state to sidebar**

At the top of `sidebar.tsx`, add the import:

```tsx
import { ChangeNameDialog } from "@/components/layout/change-name-dialog"
```

Inside the `Sidebar` component, after the existing state/hooks, add:

```tsx
const [changeNameOpen, setChangeNameOpen] = useState(false)
```

Also add `useState` to the existing React import.

- [ ] **Step 2: Make the user section clickable**

Replace the user section `<div>` (the one containing the avatar, name, and email — lines 253-271 in the current file) to make it a clickable button that opens the dialog. Replace:

```tsx
        <div className="p-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2",
              collapsed ? "justify-center" : ""
            )}
          >
            {/* Avatar circle with initials */}
            <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user?.name ?? "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email ?? ""}
                </p>
              </div>
            )}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
```

With:

```tsx
        <div className="p-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2",
              collapsed ? "justify-center" : ""
            )}
          >
            {/* Avatar + name area — clickable to change name */}
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 min-w-0 rounded-md hover:bg-sidebar-accent transition-colors",
                collapsed ? "" : "flex-1 px-1 py-1 -mx-1"
              )}
              onClick={() => setChangeNameOpen(true)}
              aria-label="Change name"
            >
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                {initials}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">
                    {user?.name ?? "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.email ?? ""}
                  </p>
                </div>
              )}
            </button>
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
```

- [ ] **Step 3: Render the ChangeNameDialog**

Right before the closing `</aside>` tag, add:

```tsx
        <ChangeNameDialog
          open={changeNameOpen}
          onOpenChange={setChangeNameOpen}
          currentName={user?.name ?? ""}
        />
```

- [ ] **Step 4: Verify the file compiles**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: wire change-name dialog into sidebar"
```

---

### Task 3: E2E test for change-name flow

**Files:**
- Create: `cypress/e2e/change-name.cy.ts`

- [ ] **Step 1: Write the Cypress E2E test**

```ts
describe("Change Name", () => {
  const password = "TestPass123!"

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Original Name", password })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("opens change name dialog from sidebar", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.contains("Change Name")
    cy.get("input#userName").should("have.value", "Original Name")
  })

  it("updates the user name successfully", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").clear().type("New Name")
    cy.contains("button", "Save").click()
    cy.contains("Name updated")
    // Sidebar shows updated name
    cy.get("aside").contains("New Name")
  })

  it("disables save when name is empty", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").clear()
    cy.contains("button", "Save").should("be.disabled")
  })

  it("resets name on cancel", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").clear().type("Temporary")
    cy.contains("button", "Cancel").click()
    // Reopen — should show original name
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").should("have.value", "Original Name")
  })
})
```

- [ ] **Step 2: Run the E2E test**

Run: `npx cypress run --spec cypress/e2e/change-name.cy.ts`
Expected: All 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/change-name.cy.ts
git commit -m "test: add E2E tests for change-name feature"
```
