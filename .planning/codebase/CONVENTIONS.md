# Coding Conventions

**Analysis Date:** 2026-03-19

## Naming Patterns

**Files:**
- Component files: `camelCase` with `.tsx` extension for React components (e.g., `page.tsx`, `layout.tsx`)
- TypeScript files: `camelCase.ts` for utilities and logic
- Styling: `globals.css` for global styles co-located with components
- Configuration files: `camelCase.mjs` or `camelCase.ts` for build/framework config (e.g., `postcss.config.mjs`, `next.config.ts`)

**Functions:**
- Event handlers and callbacks: `camelCase` prefixed with action verb (e.g., `handleChange`, `onClick`)
- React components: `PascalCase` (e.g., `RootLayout`, `Home`)
- Utility functions: `camelCase` (e.g., `geistSans`, `geistMono`)

**Variables:**
- Constants (config values, static data): `camelCase` (e.g., `geistSans`, `metadata`)
- Component props: `camelCase` (e.g., `children`, `className`)
- Type definitions: `PascalCase` (e.g., `Metadata`, `Readonly`)

**Types:**
- Type definitions from external libraries: Imported as-is (e.g., `Metadata` from `next`)
- Generic type wrappers: `PascalCase` (e.g., `Readonly<{ children: React.ReactNode }>`)
- React type utilities: Use standard library types (e.g., `React.ReactNode`)

## Code Style

**Formatting:**
- Prettier is NOT explicitly configured in the project
- TypeScript handles formatting through strict compiler options
- Indentation: 2 spaces (observed in all configuration files)
- Line length: No explicit limit enforced
- Template literals preferred over string concatenation for complex strings
- Template literals used for className assembly (e.g., `` `${geistSans.variable} ${geistMono.variable} h-full antialiased` ``)

**Linting:**
- ESLint 9 is the linter with Next.js configuration
- Configuration: `eslint.config.mjs` with flat config format (ESLint 9 style)
- Rules applied: `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Run command: `pnpm lint` (from `package.json` script: `eslint`)

## Import Organization

**Order:**
1. External packages (Next.js, React, third-party libraries)
2. Internal utilities and components (using path aliases)
3. Styles and CSS imports

**Examples:**
- `import type { Metadata } from "next";` - Next.js types first
- `import { Geist, Geist_Mono } from "next/font/google";` - Next.js utilities
- `import "./globals.css";` - Stylesheet imports last
- `import Image from "next/image";` - Next.js built-in components

**Path Aliases:**
- `@/*` maps to `./src/*` (defined in `tsconfig.json`)
- Use `@/` prefix for imports from the `src/` directory

## Error Handling

**Patterns:**
- TypeScript `strict` mode is enabled, enforcing explicit type declarations
- No observed error handling patterns in current codebase (early stage)
- `noEmit: true` in TypeScript config ensures compilation errors prevent execution
- React's built-in error boundaries should be used for component errors (not yet implemented)

## Logging

**Framework:** Console object only (no external logging framework detected)

**Patterns:**
- No logging patterns observed in current codebase
- Future logging should use `console.log()`, `console.error()`, etc. for development
- Consider structured logging library for production (e.g., Pino, Winston)

## Comments

**When to Comment:**
- JSDoc comments for exported functions and components (not yet observed in codebase)
- Inline comments for non-obvious logic and business rules
- NO observed comments in current codebase — keep code self-documenting where possible

**JSDoc/TSDoc:**
- Use for public APIs and React components
- Type annotations should be explicit (TypeScript `strict: true`)
- Example pattern (not yet observed, but follows Next.js convention):
  ```typescript
  /**
   * RootLayout component that wraps the entire application
   * @param children - The page content to render
   * @returns The HTML structure with global styles applied
   */
  export default function RootLayout({ children }: Props) { ... }
  ```

## Function Design

**Size:**
- Keep functions focused and single-purpose
- React components should remain under 50-100 lines for readability
- Split large components into smaller, reusable sub-components

**Parameters:**
- Use object destructuring for component props
- Example: `function RootLayout({ children }: Readonly<{ children: React.ReactNode }>)`
- Type parameters explicitly as `Readonly<>` for immutability when appropriate

**Return Values:**
- React components return JSX
- Utilities should have explicit return types
- Use `type` keyword for type definitions (observed in imports: `import type { Metadata }`)

## Module Design

**Exports:**
- Default exports for React components: `export default function RootLayout(...)`
- Named exports for utilities and configurations
- Use `export const` for constants and configurations

**Barrel Files:**
- Not observed in current structure
- If implementing multiple modules, create `index.ts` files to aggregate exports

## Component Structure Patterns

**Layout Components:**
- Co-locate metadata definitions with layout components
- Example (`src/app/layout.tsx`):
  ```typescript
  export const metadata: Metadata = { ... };
  export default function RootLayout({ children }) { ... }
  ```

**Page Components:**
- Default export of a functional component
- Example (`src/app/page.tsx`):
  ```typescript
  export default function Home() { ... }
  ```

## CSS & Styling

**Framework:** Tailwind CSS v4 with PostCSS

**Patterns:**
- Utility-first CSS classes via Tailwind (observed in components)
- Global CSS variables defined in `globals.css` (e.g., `--background`, `--foreground`)
- CSS custom properties used in Tailwind theme definition via `@theme inline`
- Dark mode support via `@media (prefers-color-scheme: dark)`
- Responsive design via Tailwind's responsive prefixes (e.g., `sm:`, `md:`, `dark:`)

**Example:**
```tsx
<div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
```

---

*Convention analysis: 2026-03-19*
