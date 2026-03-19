# Directory Structure

**Analysis Date:** 2026-03-19

## Overview

Standard Next.js 16 App Router scaffold. Minimal application code — effectively greenfield.

## Directory Layout

```
money-lending/
├── src/
│   └── app/                    # Next.js App Router root
│       ├── layout.tsx          # Root layout (HTML shell, fonts, global styles)
│       ├── page.tsx            # Home page (scaffold placeholder)
│       ├── globals.css         # Global CSS (Tailwind v4 imports + base styles)
│       └── favicon.ico         # Browser favicon
│
├── public/                     # Static assets served at root URL
│   ├── next.svg                # Next.js logo
│   └── vercel.svg              # Vercel logo
│
├── private_docs/               # Non-committed documentation
│   └── Money_Lending_App_Requirements.docx  # Requirements document
│
├── logs/                       # Application logs directory (empty)
│
├── node_modules/               # Dependencies (pnpm managed)
│
├── next.config.ts              # Next.js configuration (reactCompiler: true)
├── tsconfig.json               # TypeScript config (path alias: @/* → ./src/*)
├── postcss.config.mjs          # PostCSS config (Tailwind v4)
├── eslint.config.mjs           # ESLint config (Next.js rules)
├── pnpm-workspace.yaml         # pnpm workspace config
├── pnpm-lock.yaml              # Lockfile
├── package.json                # Dependencies and scripts
├── next-env.d.ts               # Next.js TypeScript declarations
├── CLAUDE.md                   # Claude Code instructions
└── AGENTS.md                   # AI agent instructions
```

## Key Locations

| Location | Purpose |
|----------|---------|
| `src/app/` | All pages and layouts (App Router) |
| `src/app/layout.tsx` | Root layout — fonts, HTML shell |
| `src/app/page.tsx` | Home page |
| `src/app/globals.css` | Global styles (Tailwind entry point) |
| `public/` | Static files served at `/` |
| `private_docs/` | Non-versioned reference documents |

## Planned Structure (money-lending domain)

```
src/
├── app/
│   ├── (auth)/                 # Auth route group
│   ├── dashboard/              # Main dashboard
│   ├── loans/                  # Loan management
│   ├── payments/               # Payment management
│   ├── reports/                # Reporting
│   └── api/                    # API route handlers
│       ├── loans/route.ts
│       ├── payments/route.ts
│       └── ...
├── components/                 # Shared UI components
├── lib/                        # Utilities, helpers
├── services/                   # Business logic
└── types/                      # TypeScript type definitions
```

## Naming Conventions

- **Files:** kebab-case for directories, PascalCase for React components (`page.tsx`, `layout.tsx`)
- **Components:** PascalCase function names (`export default function Home()`)
- **Config:** camelCase properties (`reactCompiler: true`)
- **Path alias:** `@/` maps to `./src/` (e.g., `@/components/Button`)
- **Imports:** Absolute imports via `@/` prefix preferred over relative

## Configuration Files

| File | Purpose |
|------|---------|
| `next.config.ts` | Next.js build options, reactCompiler enabled |
| `tsconfig.json` | TypeScript strict mode, `@/*` path alias |
| `postcss.config.mjs` | Tailwind v4 PostCSS plugin |
| `eslint.config.mjs` | ESLint with Next.js + core web vitals |

---

*Structure analysis: 2026-03-19*
