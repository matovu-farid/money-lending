# Technology Stack

**Analysis Date:** 2026-03-19

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code (`.ts` and `.tsx` files)
- JSX/TSX - React components in `src/app/`

**Secondary:**
- JavaScript - Configuration files (`.mjs` and `.ts` config files that are executed as JS)

## Runtime

**Environment:**
- Node.js (version requirements inferred from `@types/node@^20` - Node 20+)

**Package Manager:**
- pnpm (uses `pnpm-lock.yaml` v9.0)
- Workspace configured via `pnpm-workspace.yaml`

## Frameworks

**Core:**
- Next.js 16.2.0 - Full-stack React framework with app router, SSR/SSG capabilities
- React 19.2.4 - UI component library
- React DOM 19.2.4 - React rendering to browser DOM

**Styling:**
- Tailwind CSS 4.2.2 - Utility-first CSS framework
- PostCSS with @tailwindcss/postcss 4.2.2 - CSS processing pipeline

**Build/Dev:**
- TypeScript 5.9.3 - Static type checking and transpilation
- Babel Plugin React Compiler 1.0.0 - Automatic memoization and optimization for React components
- ESLint 9.39.4 - Code linting with Next.js specific rules
- ESLint Config Next 16.2.0 - Next.js and core web vitals linting rules

## Key Dependencies

**Critical:**
- next@16.2.0 - Why it matters: Server-side rendering, static generation, API routes, and production deployment
- react@19.2.4 - Why it matters: Component rendering and state management foundation
- react-dom@19.2.4 - Why it matters: DOM mounting and reconciliation

**Infrastructure:**
- babel-plugin-react-compiler@1.0.0 - Automatically memoizes components for performance optimization
- @tailwindcss/postcss@4.2.2 - Modern Tailwind CSS v4 with PostCSS integration
- tailwindcss@4.2.2 - CSS utility generation

**Development:**
- @types/node@20.19.37 - Type definitions for Node.js APIs
- @types/react@19.2.14 - Type definitions for React
- @types/react-dom@19.2.3 - Type definitions for React DOM

## Configuration

**Environment:**
- Environment variables supported via `.env*` files (listed in `.gitignore`)
- Next.js loads env files automatically at build and runtime
- No configuration currently requires environment variables

**Build:**
- `tsconfig.json` - TypeScript compiler options with path alias `@/*` pointing to `./src/*`
- `next.config.ts` - Next.js build configuration (reactCompiler enabled)
- `postcss.config.mjs` - PostCSS plugins configuration
- `eslint.config.mjs` - ESLint rules for code quality

## Platform Requirements

**Development:**
- Node.js 20+
- pnpm package manager
- TypeScript-aware editor (for best IDE support)

**Production:**
- Node.js 20+ (for running Next.js server)
- Can be deployed on Vercel (Next.js native platform) or any Node.js hosting
- Static export also supported via Next.js configuration

---

*Stack analysis: 2026-03-19*
