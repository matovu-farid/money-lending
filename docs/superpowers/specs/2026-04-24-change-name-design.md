# Change Name Feature

## Summary

Allow users to change their display name from the sidebar. Clicking the user name/avatar area opens a DrawerDialog with a name input.

## Trigger

The existing user section at the bottom of the sidebar becomes clickable. Clicking it opens a `DrawerDialog` (Dialog on desktop, Drawer on mobile) for editing the name.

## Dialog

- Single text input, pre-filled with the current name
- Save and Cancel buttons
- Validation: name must be non-empty after trimming
- On success: close dialog, show success toast
- On failure: keep dialog open, show error toast

## Update Mechanism

Use better-auth's built-in `authClient.updateUser({ name })` client method. This calls `POST /update-user` on the auth server and updates the session automatically. No custom server action is needed.

After a successful update, the `useSession()` hook re-renders with the new name, so the sidebar avatar initials and displayed name update automatically.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/layout/change-name-dialog.tsx` | Create — DrawerDialog with name input |
| `src/components/layout/sidebar.tsx` | Modify — make user section clickable, open ChangeNameDialog |

## Out of Scope

- Changing email, password, or avatar from this dialog
- Profile/settings page
- Admin editing other users' names (already possible via admin panel)
