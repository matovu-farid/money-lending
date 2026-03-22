# Concerns

**Last Updated:** 2026-03-22

## Resolved Issues

### 1. ~~No Test Infrastructure~~ — RESOLVED
Vitest unit tests (97), integration tests (60), and Cypress E2E (~95) all passing.

### 2. ~~No Database Layer~~ — RESOLVED
Drizzle ORM 0.45.1 with Neon PostgreSQL. 17 tables across customers, loans, payments, creditors, transactions, auth, etc.

### 3. ~~No Authentication System~~ — RESOLVED
Better Auth with RBAC plugin. Email verification via Resend. First user auto-promoted to Super Admin.

### 4. ~~No Input Validation Framework~~ — RESOLVED
TypeScript types at service boundaries. No Zod per project decision — types are sufficient.

### 5. ~~No Audit Logging~~ — RESOLVED
`writeAuditLog` in every write operation (loan, payment, creditor, customer status change). Uses direct await inside Drizzle transactions.

### 6. ~~No Role-Based Access Control~~ — RESOLVED
Better Auth RBAC plugin with admin/superAdmin roles. Middleware-based checks via proxy.ts.

## Active Issues

### 7. Integration Test Speed
**Impact:** Integration tests take ~6 minutes due to Neon network latency
**Mitigation:** Consider PGlite for local in-memory testing (eliminates cold starts, deadlocks, connection routing issues)
**Priority:** Low — tests pass reliably; this is a DX improvement

### 8. React Compiler Enabled Experimentally
**File:** `next.config.ts` — `reactCompiler: true`
**Impact:** Experimental feature in Next.js 16; may cause unexpected behavior
**Priority:** Medium — monitor for issues

### 9. No Error Boundary Implementation
**Impact:** Unhandled runtime errors will crash the entire UI
**Fix:** Add `error.tsx` files in App Router route segments
**Priority:** Medium

## Security Considerations

**Financial application security (status):**
- [x] SQL injection prevention (Drizzle ORM parameterized queries)
- [x] CSRF protection (Next.js SameSite cookies)
- [x] Secure session management (Better Auth)
- [x] Audit trail for all financial operations
- [ ] Rate limiting on API routes
- [ ] Sensitive data encryption at rest
- [ ] PII handling compliance

---

*Updated: 2026-03-22*
