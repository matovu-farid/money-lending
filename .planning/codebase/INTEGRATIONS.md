# External Integrations

**Analysis Date:** 2026-03-19

## APIs & External Services

**Current State:**
- No external API integrations detected in the codebase
- No SDK imports or external service clients imported
- Application is a template/starter project with no live integrations

## Data Storage

**Databases:**
- Not configured
- No database client or ORM detected (no prisma, drizzle, sequelize, etc.)

**File Storage:**
- Local filesystem only
- Static files served from `public/` directory via Next.js

**Caching:**
- Not configured
- No caching library dependencies detected

## Authentication & Identity

**Auth Provider:**
- Not implemented
- No authentication library present in dependencies

## Monitoring & Observability

**Error Tracking:**
- Not configured
- No error tracking service integrated

**Logs:**
- Console logging only via standard JavaScript `console.*` methods
- No structured logging framework configured

## CI/CD & Deployment

**Hosting:**
- Vercel (implied by template, but not enforced)
- Can be deployed on any Node.js-compatible host

**CI Pipeline:**
- Not configured
- No GitHub Actions or CI workflows present

## Environment Configuration

**Required env vars:**
- None currently required
- Support for env files exists but none are configured

**Secrets location:**
- Env files (`.env`, `.env.local`, `.env.production`, etc.)
- These are in `.gitignore` and not committed to repository

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Google Fonts

**Service:**
- Google Fonts API used indirectly via Next.js font optimization
- Fonts loaded in `src/app/layout.tsx`:
  - Geist (Sans) - used as `--font-geist-sans`
  - Geist Mono - used as `--font-geist-mono`
- Fonts automatically optimized by Next.js at build time

---

*Integration audit: 2026-03-19*
