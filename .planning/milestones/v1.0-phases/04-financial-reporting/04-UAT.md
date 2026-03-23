---
status: testing
phase: 04-financial-reporting
source: 04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md, 04-08-SUMMARY.md
started: 2026-03-22T10:00:00Z
updated: 2026-03-22T10:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Cold Start Smoke Test
expected: |
  Kill any running dev server. Run `pnpm dev` from scratch. Server boots without errors on http://localhost:3000. The login page loads. After signing in, the dashboard loads with all KPI cards visible including "Capital in System".
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server. Run `pnpm dev` from scratch. Server boots without errors on http://localhost:3000. The login page loads. After signing in, the dashboard loads with all KPI cards visible including "Capital in System".
result: [pending]

### 2. Register a Creditor
expected: Navigate to Creditors in the sidebar. Click to add a new creditor. Fill in name, contact, address, investment amount, and interest rate. Submit. You are redirected to the creditor list and the new creditor appears in the table.
result: [pending]

### 3. Creditor List with System Capital KPIs
expected: The Creditors page shows a 4-card KPI grid at the top: Total Invested, Total Interest Accrued, Total Repayments Made, Total Outstanding. Below is a table of all registered creditors.
result: [pending]

### 4. Creditor Profile with Investment and Repayment
expected: Click on a creditor name to view their profile. The profile shows per-creditor KPI cards. Two tabs are visible: Investments and Repayments. You can click "Add Investment" to open a dialog and add a new investment. You can click "Record Repayment" to open a dialog, select an investment, and record a repayment.
result: [pending]

### 5. Record an Expense
expected: Navigate to "Expenses & Income" > Expenses in the sidebar. Click to add an expense. A sheet slides in from the right with fields for date, category, amount, and notes. Submit the expense. It appears in the expenses table. You can also create a new category inline via the popover next to the category dropdown.
result: [pending]

### 6. Record Income
expected: Navigate to the Income page. Same pattern as expenses — add income via a sheet, select an income category, enter amount and date. The entry appears in the income table.
result: [pending]

### 7. Transaction Log with Filters
expected: Navigate to the Transaction Log page. All recorded expenses, income, and auto-posted interest entries appear in a single table. Filter by type (credit/debit), category, or date range. Filters update the table (debounced). Income entries show as green, expenses as red.
result: [pending]

### 8. Reports Hub
expected: Navigate to Reports in the sidebar. A hub page shows 4 cards linking to: Loan Portfolio, Profit & Loss, Balance Sheet, and Transaction Log. Clicking any card navigates to that report page.
result: [pending]

### 9. P&L Report with Period Picker
expected: Open the P&L report. A period picker shows the last 12 months. The report displays income items with a Total Income subtotal, expense items with a Total Expenses subtotal, and a Net Profit row at the bottom (green if positive, red if negative).
result: [pending]

### 10. Balance Sheet Report
expected: Open the Balance Sheet report. It shows three sections: Assets (total loans outstanding), Liabilities (creditor balances), and Equity (share capital + retained earnings). A summary row shows Total Liabilities + Equity.
result: [pending]

### 11. Export Report to PDF
expected: From any report page (P&L, Balance Sheet, or Portfolio), click the PDF export button. A PDF file downloads with a branded header ("Money Lending Management"), the report title, period, and formatted tables. The PDF opens correctly in a standard viewer.
result: [pending]

### 12. Export Report to Excel
expected: From any report page, click the Excel export button. An .xlsx file downloads with styled header rows (dark background, white text), alternating row colors, UGX currency formatting, and frozen header row. The file opens correctly in Excel or Google Sheets.
result: [pending]

### 13. Dashboard Capital in System KPI
expected: Go to the Dashboard. The "Capital in System" KPI card shows a real number (not "0.00" placeholder). If creditors have been registered with investments, the figure reflects total outstanding (principal + accrued interest).
result: [pending]

### 14. Loan Portfolio Report
expected: Open the Loan Portfolio report from the Reports hub. A table shows all loans with columns: customer name, loan amount, outstanding balance, interest accrued, days overdue, status, and risk badge. Loans >= 30 days overdue show a red "At Risk" badge.
result: [pending]

## Summary

total: 14
passed: 0
issues: 0
pending: 14
skipped: 0

## Gaps

[none yet]
