# Graph Report - .  (2026-07-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2765 nodes · 8659 edges · 244 communities (170 shown, 74 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a21c3409`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 78
- Community 80
- Community 81
- Community 82
- Community 84
- Community 85
- Community 86
- Community 88
- Community 90
- Community 91
- Community 92
- Community 93
- Community 95
- Community 96
- Community 99
- Community 100
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 116
- Community 117
- Community 118
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 188
- Community 190
- Community 191
- Community 235

## God Nodes (most connected - your core abstractions)
1. `cn()` - 157 edges
2. `effect` - 119 edges
3. `formatCurrency()` - 72 edges
4. `Button()` - 61 edges
5. `db` - 60 edges
6. `formatDate()` - 55 edges
7. `shortId()` - 55 edges
8. `usePermissions()` - 50 edges
9. `getQueryClient()` - 50 edges
10. `formatAmount()` - 48 edges

## Surprising Connections (you probably didn't know these)
- `createLoanAction()` --references--> `effect`  [EXTRACTED]
  src/actions/loan.actions.ts → package.json
- `countPendingRequestsAction()` --references--> `effect`  [EXTRACTED]
  src/actions/rate-change-request.actions.ts → package.json
- `listAllRequestsAction()` --references--> `effect`  [EXTRACTED]
  src/actions/rate-change-request.actions.ts → package.json
- `requestRateChangeAction()` --references--> `effect`  [EXTRACTED]
  src/actions/rate-change-request.actions.ts → package.json
- `reviewRateChangeRequestAction()` --references--> `effect`  [EXTRACTED]
  src/actions/rate-change-request.actions.ts → package.json

## Import Cycles
- 3-file cycle: `src/lib/interest/engine.ts -> src/lib/interest/loanBalanceData.ts -> src/lib/interest/overdue.ts -> src/lib/interest/engine.ts`

## Communities (244 total, 74 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (64): getTransactionReceiptDataAction, AddCreditorDialogProps, CreditorFormValues, InvestmentFormValues, Props, RepaymentFormValues, NOTE: We deliberately do NOT wrap these handlers in useTransition. The, DeleteLoanDialogProps (+56 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (72): effect, effect, GET(), creditorInvestments, creditorRepayments, creditors, formatAmount(), autoPostCreditorInvestment() (+64 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (63): react, react, CreditorProfileClient(), formatMonth(), Props, NewCustomerPage(), AdminQueue, AllowlistEntry (+55 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (65): addInvestmentAction, createCreditorAction, createCreditorWithInvestmentAction, getCreditorDashboardAction, getCreditorMonthlyInterestDueAction, getCreditorMonthlySummaryAction, getCreditorRepaymentPortionsAction, getCreditorsPageDataAction (+57 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (39): ACTION_BADGE_COLORS, ActivitiesClient(), ActivitiesContentProps, ENTITY_TYPES, AdminContentProps, EditFormValues, PaymentTableProps, customerCollection (+31 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (49): listCreditorRepaymentsAction, IncomePage(), creditorRepaymentCollection, CustomerUpdateMetadata, delegationCollection, expenseCategoryCollection, ExpenseCategoryRow, expenseCollection (+41 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (32): LoanWithOverdue, RateChangeDialogProps, reportCards, ROLE_LABELS, SetPasswordForm, LoginFormValues, autoCapitalize(), RegisterFormValues (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (53): changeCustomerStatusAction, createCustomerAction, getCustomerAction, listCustomersAction, updateCustomerAction(), updateCustomerWrapped, getLoanPredecessorChainAction, getLoanSuccessorAction (+45 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (43): formatTime(), ApprovalsContent(), AddCreditorDialog(), Creditor, CreditorsTable(), getColumns(), Props, AddInvestmentDialog() (+35 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (32): DATE, mockCheckPermission, mockGetSession, mockPortions, ReceiptActionTypeSnapshots, rowsByTable, account, accountRelations (+24 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (50): APPLY, LoanReport, main(), PaymentDelta, SimulatorResult, escapeLikePattern(), allocateLoanPayment, allocateLoanPaymentServerSide() (+42 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (32): checkRolloverChainIntegrity(), main(), GET(), shouldResetPenaltyWaiver(), checkEmailExists(), db, globalForDb, Postgres (+24 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (50): getLoanCollateralAction, AdminContent(), getRoleOptions(), InvitationsSection(), LoanDetailClient(), NewLoanPageInner(), activeLoanCheckCollections, ActiveLoanCheckCollectionType (+42 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (35): Logo(), LogoMark(), LogoMarkProps, LogoProps, actionItems, CommandItem, CommandPalette(), navigationItems (+27 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (48): adjustPenaltyMultiplierAction(), adjustPenaltyMultiplierWrapped, createLoanAction(), CustomerLoansData, deleteLoanAction, getCollateralNaturesAction(), getCustomerLoansWithOverdueAction, getLoanPaymentContextAction (+40 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (43): getCurrentUserRoleAction(), countPendingRequestsAction(), listAllRequestsAction(), listRateChangeRequestsAction, listRequestsForLoanAction, requestRateChangeAction(), RequestRateChangeResult, reviewRateChangeRequestAction() (+35 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (42): getBalanceSheetReportAction, getCashflowReportAction, getPnlReportAction, getPortfolioReportAction, getRetainedEarningsReportAction, getTransactionReportDataAction, mockGetBalanceSheetData, mockGetCurrentMonth (+34 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (42): rateChangeRequests, CategoryInUseError, CategoryNotFound, ConversationNotFound, CreditorNotFound, CustomerNotFound, DatabaseError, DuplicateError (+34 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (38): clearAllowlistAction, getIpAllowlistStateAction, removeAllowlistEntryAction, RemoveInput, setIpAllowlistEnabledAction, ToggleInput, adminSession, POST() (+30 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (38): waivePenaltyAction, deletePaymentAction, editPaymentAction, mockCheckPermission, mockDeletePayment, mockEditPayment, mockGetEffectivePermissions, mockGetSession (+30 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (35): getUniqueConstraintName(), getUniqueConstraintNameDeep(), isUniqueConstraintError(), writeAuditLog(), autoPostCapitalInjection(), autoPostFundTransfer(), createBankAccount(), createBankAccountWithTxid() (+27 more)

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (33): createDelegationAction, listDelegationsAction, revokeDelegationAction, createInviteAction, listInvitationsAction, resendInviteAction, revokeInviteAction, finalizeInviteAcceptance() (+25 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (27): CreditorsContent(), CreditorsPage(), defaultCapital, CollectionsChart, DashboardContent(), DashboardPage(), LoanDistributionChart, DailyCollectionsContent() (+19 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (35): getLoanBalanceAction, getPaymentPortionsAction, getPaymentsByLoanAction, getPaymentsForLoanIdsAction, getRecentlyCollectedLoansAction, listAllPaymentsAction, listPaymentsAction, LoanBalanceSummary (+27 more)

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (24): AdminLayout(), AdminPage(), ApprovalsPage(), CreditorProfilePage(), Props, DashboardLayout(), FundTransfersLayout(), FundTransfersContent() (+16 more)

### Community 25 - "Community 25"
Cohesion: 0.09
Nodes (27): deleteExpenseAction, listExpenseCategoriesAction, listExpensesAction, listExpenseTransactionsAction, recordExpenseAction, deleteIncomeAction, listIncomeAction, listIncomeCategoriesAction (+19 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (29): **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.tsx, compilerOptions, allowJs (+21 more)

### Community 27 - "Community 27"
Cohesion: 0.11
Nodes (23): searchCustomersAction, exportLoansExcelAction, getLoanListEntriesByIdsAction, buildLoansPrintHtml(), categorize(), criticalityRank(), escapeHtml(), FilterCategory (+15 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (22): getDailyCollectionsAction, getLoansDueTodayAction, mockGetDailyCollections, mockGetLoansDueToday, mockGetSession, mockCheckPermission, mockGetSession, SettingRow (+14 more)

### Community 29 - "Community 29"
Cohesion: 0.10
Nodes (24): createCapitalInjectionAction, createFundTransferAction, listFundTransfersAction, NOTE: No revalidatePath calls in these actions. The /fund-transfers and, mockCheckPermission, mockCreateCapitalInjectionWithTxid, mockCreateFundTransferWithTxid, mockGetSession (+16 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (16): SimulatorPanel(), daysBetween(), calculateInterest(), simulateLoanLifecycle(), advanceTimeCmd, AdvanceTimeCommand, allCommands, checkInvariants() (+8 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (22): getLoanWithBalanceAction, CustomerProfileContent(), LoanDetailPage(), pinCollectionKey(), unpinCollectionKey(), JoinedLoanRow, mapJoinedRow(), useLoansForCustomer() (+14 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (21): ExpenseListClient(), ExpenseListClientProps, ExpensesPage(), IncomeListClient(), IncomeListClientProps, TransactionLogClientProps, TransactionListClientProps, TransactionType (+13 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (21): getActivitiesAction, activitiesCollections, ActivitiesCollectionType, ActivitiesRow, ActivityFilterParams, createActivitiesCollection(), getActivitiesCollection(), createCreditorDashboardCollection() (+13 more)

### Community 34 - "Community 34"
Cohesion: 0.07
Nodes (27): scripts, build, cypress:open, cypress:run, db:backfill-allocations, db:generate, db:mark-applied, db:migrate (+19 more)

### Community 35 - "Community 35"
Cohesion: 0.14
Nodes (19): getDashboardAction, getDashboardActivityAction, getRecentActivityAction(), getRecentActivityWrapped, mockGetActivities, mockGetSession, mockGetDashboardKPIs, mockGetRecentActivity (+11 more)

### Community 36 - "Community 36"
Cohesion: 0.10
Nodes (22): createBankAccountAction, listBankAccountsAction, updateBankAccountAction, ReportCard, fakeSession, mockCheckPermission, mockGetErrorTag, mockGetSession (+14 more)

### Community 37 - "Community 37"
Cohesion: 0.20
Nodes (17): GET(), GET(), GET(), GET(), GET(), TransactionLogPage(), TransactionLogPageProps, getEffectivePermissions (+9 more)

### Community 38 - "Community 38"
Cohesion: 0.20
Nodes (13): BalanceSheetClient(), BalanceSheetClientProps, BalanceSheetPage(), RetainedEarningsPage(), RetainedEarningsClient(), RetainedEarningsClientProps, ReportToolbar(), ReportToolbarProps (+5 more)

### Community 39 - "Community 39"
Cohesion: 0.09
Nodes (23): babel-plugin-react-compiler, eslint-config-next, fast-check, devDependencies, babel-plugin-react-compiler, eslint-config-next, fast-check, pino-pretty (+15 more)

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (16): checkCustomerActiveLoanAction, settleWithCollateralAction, mockCheckPermission, mockGetCustomerActiveLoan, mockGetSession, mockRequireRole, mockRevalidatePath, mockSettleWithCollateral (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.09
Nodes (22): AdminNotificationProps, body, container, content, copyright, ctaButton, ctaFallback, ctaSection (+14 more)

### Community 42 - "Community 42"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (17): dailyCollectionsMap, DailyCollectionsRow, DailyCollectionType, getDailyCollectionsCollection(), LoanDueTodayRow, loansDueTodayCollection, loanStatusCountsCollection, LoanStatusCountsRow (+9 more)

### Community 44 - "Community 44"
Cohesion: 0.20
Nodes (18): calculateCreditScore(), combinedWeights(), CreditScoreBreakdown, CreditScoreResult, daysBetween(), getBand(), recencyWeight(), SCORE_BANDS (+10 more)

### Community 45 - "Community 45"
Cohesion: 0.10
Nodes (20): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, paths (+12 more)

### Community 46 - "Community 46"
Cohesion: 0.16
Nodes (13): auditLog, main(), AuditEntry, createCategory(), DEFAULT_ASSET_CATEGORIES, DEFAULT_EQUITY_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_LIABILITY_CATEGORIES (+5 more)

### Community 47 - "Community 47"
Cohesion: 0.15
Nodes (19): computeAllLoansBalanceData(), computeLoanBalanceDataArray(), adjustPenaltyMultiplier(), computeOverdue(), getCustomerLoansWithOverdue(), getLoan(), getLoanListEntriesByIds(), getLoanListEntryById() (+11 more)

### Community 48 - "Community 48"
Cohesion: 0.13
Nodes (17): InjectionFormValues, TransferFormValues, PaymentFormValues, QuickRecordFormValues, ExpenseInsertMetadata, IncomeInsertMetadata, TransactionFormValues, defaults (+9 more)

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (15): ReviewStepProps, allocateFixedRatePayment(), allocatePayment(), allocateReducingBalancePayment(), calculateDaysOverdue(), calculateLoanSummary(), calculateSchedule(), computeOutstanding() (+7 more)

### Community 50 - "Community 50"
Cohesion: 0.14
Nodes (14): BreakdownTable(), CashflowClient(), formatMonthLabel(), Props, SummaryCell(), CashflowPage(), PortfolioClient(), TransactionLogClient() (+6 more)

### Community 51 - "Community 51"
Cohesion: 0.11
Nodes (17): ResetPasswordTemplate(), body, button, buttonSection, container, content, copyright, footer (+9 more)

### Community 53 - "Community 53"
Cohesion: 0.12
Nodes (16): LoanDetailClientProps, LoanSearchCombobox(), LoanSearchComboboxProps, RecentLoan, ActiveLoansClientProps, ActiveLoanSearchResult, Collateral, CollateralInput (+8 more)

### Community 54 - "Community 54"
Cohesion: 0.12
Nodes (16): body, button, buttonSection, container, content, copyright, footer, header (+8 more)

### Community 55 - "Community 55"
Cohesion: 0.12
Nodes (12): addedRows, columnWidths, createMockRow(), mockAddRow, mockCells, mockEachCell, mockGetCell(), mockGetColumn (+4 more)

### Community 56 - "Community 56"
Cohesion: 0.19
Nodes (8): asOfDateUTC(), periodBoundsUTC(), baseLoan, arbDay, arbFullDate, arbMonth, arbPeriod, arbYear

### Community 57 - "Community 57"
Cohesion: 0.12
Nodes (15): body, button, buttonSection, container, content, copyright, footer, header (+7 more)

### Community 58 - "Community 58"
Cohesion: 0.17
Nodes (12): getSettingsAction, GetSettingsResult, SettingKey, updateSettingAction, UpdateSettingInput, UpdateSettingResult, VALID_SETTING_KEYS, systemSettings (+4 more)

### Community 59 - "Community 59"
Cohesion: 0.18
Nodes (11): DIRECTION_MAP, NotificationEvent, NotificationPayload, resend, resolveCreditorContext(), resolveCreditorRepaymentContext(), sendAdminNotification(), SUBJECT_MAP (+3 more)

### Community 60 - "Community 60"
Cohesion: 0.17
Nodes (9): computeDailyRate(), computeLoanOverdueInfo(), baseLoan, serverDailyRate(), addDays(), BASE_DATE, makeLoan(), makeParams() (+1 more)

### Community 61 - "Community 61"
Cohesion: 0.42
Nodes (13): shortId(), getCreditorRepaymentPortionsFromLedger(), buildCreditorInvestmentReceipt(), buildCreditorRepaymentReceipt(), buildExpenseReceipt(), buildFundTransferReceipt(), buildIncomeReceipt(), buildReceipt() (+5 more)

### Community 62 - "Community 62"
Cohesion: 0.45
Nodes (11): jspdf, jspdf, addBrandedHeader(), addPageNumbers(), formatDate(), formatUGX(), generateBalanceSheetPdf(), generatePnlPdf() (+3 more)

### Community 63 - "Community 63"
Cohesion: 0.32
Nodes (9): getEffectiveRate(), isPenaltyActive(), calculateDailyRate(), calculateDaysOverdueFromInterestAccrued(), computeFixedLoanOverdueInfo(), computeOverdueInfoFromInterestAccrued(), computePerpetualOverdueInfo(), LoanOverdueInfo (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.47
Nodes (11): applyDataRowStyle(), applyHeaderStyle(), formatDateStr(), generateBalanceSheetExcel(), generateLoansExcel(), generatePnlExcel(), generatePortfolioExcel(), generateTransactionsExcel() (+3 more)

### Community 65 - "Community 65"
Cohesion: 0.18
Nodes (11): @base-ui/react, date-fns, drizzle-zod, jspdf-autotable, next, dependencies, @base-ui/react, date-fns (+3 more)

### Community 66 - "Community 66"
Cohesion: 0.18
Nodes (10): cypress, cypress, nodeVersion, name, packageManager, pnpm, executionEnv, onlyBuiltDependencies (+2 more)

### Community 67 - "Community 67"
Cohesion: 0.24
Nodes (9): LoanStatementDialogProps, addDays(), buildLoanStatement(), BuildStatementInput, CycleSnapshot, daysBetween(), LoanStatement, StatementEvent (+1 more)

### Community 68 - "Community 68"
Cohesion: 0.24
Nodes (7): geistMono, geistSans, metadata, viewport, isFetchLikeRejection(), OfflineIndicator(), Toaster()

### Community 69 - "Community 69"
Cohesion: 0.18
Nodes (10): arbDate, arbDays, arbEdgeDate, arbLoanParams, arbMinDays, arbPeriod, arbPrincipal, arbRate (+2 more)

### Community 70 - "Community 70"
Cohesion: 0.29
Nodes (7): initialState, LoanDetailActions, LoanDetailState, useLoanDetailStore, PaymentsPageActions, PaymentsPageState, PaymentWithCustomer

### Community 71 - "Community 71"
Cohesion: 0.22
Nodes (9): DailyCollectionRow, DeletePaymentInput, EditPaymentInput, ListPaymentsInput, NewPayment, Payment, ReceiptPaymentData, RecentlyCollectedLoan (+1 more)

### Community 72 - "Community 72"
Cohesion: 0.32
Nodes (5): register(), beforeSend(), PII_KEYS, scrubEvent(), scrubValue()

### Community 73 - "Community 73"
Cohesion: 0.25
Nodes (7): background_color, display, icons, name, short_name, start_url, theme_color

### Community 74 - "Community 74"
Cohesion: 0.25
Nodes (7): mockComputeLoanOverdueInfo, mockFindMany, mockGetInterestEarnedFromLedger, mockGetLastSettlementEventsForLoans, mockGetLoanBalancesFromLedger, mockGetRemainingPrincipalFromLedger, mockSelect

### Community 75 - "Community 75"
Cohesion: 0.39
Nodes (6): randomDecimal(), randomEdgeDate(), randomInt(), randomPaymentAmount(), randomPrincipal(), randomRate()

### Community 76 - "Community 76"
Cohesion: 0.15
Nodes (8): PnlPage(), PnlClient(), PnlClientProps, usePnlReport(), autoTableCalls, MockJsPDF, PnlData, PortfolioEntry

### Community 78 - "Community 78"
Cohesion: 0.47
Nodes (4): freshNeonSql(), freshSql(), withNeonSql(), withSql()

### Community 80 - "Community 80"
Cohesion: 0.47
Nodes (4): beforeSend(), PII_KEYS, scrubEvent(), scrubValue()

### Community 81 - "Community 81"
Cohesion: 0.47
Nodes (4): ActivitiesContent(), AdminUser, adminUserCollection, useAdminUsers()

### Community 82 - "Community 82"
Cohesion: 0.33
Nodes (3): MIGRATIONS_FOLDER, REPO_ROOT, SCRIPT_PATH

### Community 85 - "Community 85"
Cohesion: 0.40
Nodes (3): TEST_PRESETS, TEST_SUGGESTIONS, TestForm

### Community 86 - "Community 86"
Cohesion: 0.50
Nodes (3): computeReceiptAllocation(), ReceiptAllocation, ReceiptBalanceData

### Community 88 - "Community 88"
Cohesion: 0.40
Nodes (4): baseCustomer, baseLoanInput, mockCollateral, mockLoan

### Community 93 - "Community 93"
Cohesion: 0.50
Nodes (3): STEP_LABELS, StepIndicator(), StepIndicatorProps

### Community 95 - "Community 95"
Cohesion: 0.83
Nodes (3): ledgerQuery(), mockQueryDb(), setupDbLedger()

## Knowledge Gaps
- **786 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+781 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **74 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Community 65` to `Community 1`, `Community 130`, `Community 2`, `Community 132`, `Community 133`, `Community 135`, `Community 136`, `Community 137`, `Community 138`, `Community 139`, `Community 140`, `Community 141`, `Community 142`, `Community 143`, `Community 144`, `Community 145`, `Community 146`, `Community 147`, `Community 148`, `Community 149`, `Community 150`, `Community 151`, `Community 152`, `Community 153`, `Community 154`, `Community 155`, `Community 156`, `Community 157`, `Community 158`, `Community 159`, `Community 62`, `Community 66`, `Community 110`, `Community 111`, `Community 112`, `Community 113`, `Community 123`, `Community 125`, `Community 126`, `Community 127`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `effect` connect `Community 1` to `Community 65`, `Community 35`, `Community 37`, `Community 9`, `Community 10`, `Community 11`, `Community 46`, `Community 14`, `Community 15`, `Community 17`, `Community 18`, `Community 47`, `Community 20`, `Community 25`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `cn()` connect `Community 2` to `Community 0`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 12`, `Community 13`, `Community 84`, `Community 22`, `Community 24`, `Community 27`, `Community 31`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _786 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07726655018443021 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05792759051186017 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.040123456790123455 - nodes in this community are weakly interconnected._