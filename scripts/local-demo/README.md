# Local Money Lending demo

The running demo is **http://127.0.0.1:3483**. It uses a private copy of the app and the dedicated local database `fidexa_money_lending_demo_20261011` on PostgreSQL 17 at `127.0.0.1:5432`.

From `/Users/faridmatovu/projects/money-lending`, restart it with:

```sh
node scripts/local-demo/start.mjs
```

The demo launcher overrides database aliases, uses a fresh Better Auth secret, and blocks outbound server requests. It runs the ordinary authentication and role permissions, without Cypress/test authentication bypasses. The existing server on port 3482 and the original `.env` are untouched. Use the demo launcher for recordings: ordinary `pnpm dev` still uses the original environment.

Local-only login details are in `.local-demo/demo-login.json`. The browser tab is already signed in with a sanitized existing administrator account. Do not share that file.

## Data policy

- The original production snapshot was read-only. No production writes or migrations were run.
- Customer, staff and creditor names, contact details, NINs, addresses, images, bank labels, collateral descriptions, free-text notes and audit history were sanitized.
- Loan/payment/transaction amounts, rates, dates, statuses, balances, internal IDs and relationships were retained. Standard accounting category names remain intact because calculations depend on them.
- Copied sessions, invitations, verification links and IP records were removed locally. Passwords were replaced and copied provider tokens cleared.
- The demo uses existing records from the sanitized snapshot; no business records are seeded. Snapshot-specific counts stay in the private verification report.
- Before-and-after fingerprints verified the retained fields in 25 tables. Financial triggers were restored after sanitization. The runtime uses the restricted `fidexa_demo_app` role. Financial and other business records are read-only; writes are limited to sessions and IP login records.
- The user explicitly approved `fidexa_demo_app`. Its permissions were verified across every public table, and attempted updates to seven financial tables were denied. The launcher refuses to use the database owner as its runtime role.

Private `.local-demo/` contains the source dump, configuration, app copy and verification reports. It is ignored by Git, with directory mode 0700 and private files mode 0600. Nothing in it belongs in public site assets.

## Verification

```sh
node --test scripts/local-demo/helpers.test.mjs scripts/local-demo/network-guard.test.cjs
node scripts/local-demo/sanitize.mjs verify
node scripts/local-demo/test-ui.mjs
```

The UI check uses a separate Cypress configuration, regular login and read-only navigation. It never loads the application's DB-reset/seed task configuration. Twelve checks cover every sidebar page and an existing customer and loan detail. Financial fingerprints are checked again after navigation.

## Implementation files

- `bootstrap.mjs`: explicitly invoked read-only production snapshot and one-time guarded local restore. It refuses to replace an existing demo database/role.
- `sanitize.mjs`: schema classification, atomic sanitization, financial comparison, identity checks and later `verify` mode. It refuses to sanitize an already verified copy twice.
- `prepare-app.mjs`: isolated app copy, shared installed dependencies and hidden Next development indicator. No `.env` files are copied.
- `restrict-runtime.mjs`: one-time approved local role creation and privilege verification.
- `start.mjs` and `network-guard.cjs`: restricted-role launch and outbound request block.
- Helper tests and isolated Cypress config/spec/runner: repeatable data-policy and UI checks.

The native Postgres service must be running before starting the demo. Keep this snapshot unchanged while recording; use filters, expand panels and navigate existing records.
