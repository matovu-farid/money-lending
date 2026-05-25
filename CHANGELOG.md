# Changelog

All notable changes are recorded here. Earlier milestones (v1.0 MVP, v1.1
Payments, v1.2 Responsive) are summarised at the bottom for context.

## v1.3 — 2026-05-26

### Security & privacy
- Admin IP allowlist: capture login IPs, gate page navigation, server actions,
  and Electric shape requests for lower-role users; `/access-blocked` flow,
  inspector Sheet, and block log.
- Creditor data is admin-only across all three layers (server actions, UI
  routes, Electric proxy allowlist).
- IP allowlist auto-clears on admin demotion.

### Infrastructure
- Migrated off Neon: self-hosted ElectricSQL + Postgres on Hetzner node1 via
  Docker Swarm, with nginx caching proxy.
- Weekly Postgres backup to S3 via GitHub OIDC, with local verification of the
  dump before upload.
- Sentry wired across server, edge, and client; source-map upload on deploy.

### Loans & payments
- **Interest period boundary fix.** Per-payment allocation now computes its
  own period's interest instead of folding the previous boundary payment into
  the new window. Five production payments backfilled (~UGX 1.87M of
  under-credited interest restored).
- First 30-day perpetual loans restore interest-first allocation.
- Banker's rounding and 2dp precision throughout the ledger; 1/30 ULP loss in
  rate math removed.
- `deleteLoan` reverses the principal disbursement (not the issuance fee).
- Soft-deleted loans and their payments hidden across all surfaces.
- Loan detail page shows both Principal Balance and Total Due, with
  days-overdue and penalty badges.
- Record-only loan period for perpetual loans.

### Receipts & printing
- POS thermal receipts for disbursement and repayment, with auto-save image
  and auto-print on issue.
- Print font bumped to 14px for readability on 80mm rolls.
- Print button on the loans page alongside Export Excel.

### UI / UX
- Brand rename to **Kaks Credit**.
- shadcn `DatePicker` everywhere (no more native date inputs).
- Mobile tab bar with 44px touch targets.
- `DrawerDialog` responsive pattern: Sheet on desktop, Drawer on mobile.

### Validation
- NIN validator iterated to its final form (14 alphanumeric, length-only).

### Database
- FK `ON DELETE` policies aligned: loan-owned tables (payments, collateral,
  rate_change_requests) cascade; creditor capital chain
  (creditor_investments, creditor_repayments) cascades; `loans.rolled_over_from`
  and `audit_log.actor_id` set null; explicit RESTRICT kept on
  customers / sub_locations / categories.

---

## v1.2 — 2026-03-26
Responsive — mobile viewport coverage across all specs, touch targets,
DrawerDialog migration.

## v1.1 — 2026-03-24
Payments — payment lifecycle, edit/delete with audit trail, ledger projection.

## v1.0 — 2026-03-23
MVP — loans, customers, payments, auth, role hierarchy.
