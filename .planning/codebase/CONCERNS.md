# Concerns

**Analysis Date:** 2026-03-19

## Critical Issues

### 1. No Test Infrastructure
**File:** `package.json` — no test script or test dependencies
**Impact:** Financial calculation bugs undetectable; regressions ship silently
**Fix:** Add Vitest + React Testing Library before writing business logic
**Priority:** Critical — must resolve before implementing loan/payment logic

### 2. No Database Layer
**Impact:** No persistence — application cannot function as a money-lending platform
**Fix:** Choose and configure ORM (Prisma recommended) + database before Phase 1
**Priority:** Critical — blocking all domain functionality

### 3. No Authentication System
**Impact:** No user identity, no access control, no session management
**Fix:** Integrate Clerk or NextAuth.js early; needed for all protected routes
**Priority:** Critical — all financial data requires authentication

### 4. No Input Validation Framework
**Impact:** User inputs to API routes unvalidated — data integrity and security risk
**Fix:** Add Zod for schema validation at API boundaries
**Priority:** Critical — financial applications require strict validation

### 5. No Audit Logging
**Impact:** Financial transactions require audit trail for compliance and debugging
**Fix:** Implement audit log table/service before any financial write operations
**Priority:** Critical for financial domain

## High Priority Issues

### 6. No Role-Based Access Control
**Impact:** Loans involve multiple roles (borrower, lender, admin) — no RBAC pattern exists
**Fix:** Design and implement middleware-based RBAC before building loan features
**Priority:** High

### 7. No Environment Configuration Example
**File:** No `.env.example` file exists
**Impact:** Developers and deployment have no reference for required env vars
**Fix:** Create `.env.example` with all required variables (db url, auth keys, etc.)
**Priority:** High

### 8. React Compiler Enabled Experimentally
**File:** `next.config.ts` — `reactCompiler: true`
**Impact:** Experimental feature may cause unexpected behavior; limited ecosystem support
**Fix:** Evaluate necessity; disable if issues arise during development
**Priority:** Medium

## Medium Priority Issues

### 9. No Prettier Configuration
**Impact:** Code formatting inconsistency across team
**Fix:** Add `.prettierrc` and `prettier` dev dependency
**Priority:** Medium

### 10. No Error Boundary Implementation
**Impact:** Unhandled runtime errors will crash the entire UI
**Fix:** Add `error.tsx` files in App Router route segments
**Priority:** Medium

### 11. pnpm Workspace Configured But Single Package
**File:** `pnpm-workspace.yaml`
**Impact:** Workspace overhead with no current benefit; may indicate planned monorepo
**Note:** Investigate if monorepo architecture is intended
**Priority:** Low — informational

## Security Considerations

**Financial application security checklist (not yet addressed):**
- [ ] SQL injection prevention (via ORM parameterized queries)
- [ ] CSRF protection (Next.js provides via SameSite cookies)
- [ ] Rate limiting on API routes
- [ ] Sensitive data encryption at rest
- [ ] PII handling compliance
- [ ] Secure session management
- [ ] Input sanitization

## Tech Debt

**Current state:** Effectively zero application tech debt — this is a fresh scaffold.

**Risks to watch as development begins:**
- Business logic leaking into API route handlers (should live in services layer)
- Interest calculation logic duplicated across endpoints
- No separation between domain logic and infrastructure concerns

---

*Concerns analysis: 2026-03-19*
