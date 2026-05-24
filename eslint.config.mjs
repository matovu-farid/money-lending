import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
  ]),
  // Honor the standard `_`-prefix convention: variables, arguments, and
  // destructured names beginning with `_` are intentionally unused.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Cypress augments its own `Cypress.Chainable` interface via TypeScript
  // namespace declarations — `declare global { namespace Cypress { ... } }`
  // is the *only* supported extension mechanism (Cypress doesn't expose its
  // types as an ES module). Scope the allowance to the Cypress support folder
  // so the rest of the codebase remains namespace-free.
  {
    files: ["cypress/support/**/*.ts"],
    rules: {
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
]);

export default eslintConfig;
