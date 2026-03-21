import { Data } from "effect"

export class DatabaseError extends Data.TaggedError("DatabaseError")<{ cause: unknown }> {}
export class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{ id: string }> {}
export class LoanNotFound extends Data.TaggedError("LoanNotFound")<{ id: string }> {}
export class ValidationError extends Data.TaggedError("ValidationError")<{ message: string; field?: string }> {}
export class IncompleteLoanRequirements extends Data.TaggedError("IncompleteLoanRequirements")<{ missing: string[] }> {}
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{ reason: string }> {}
export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{ action: string; role: string }> {}
export class DuplicateError extends Data.TaggedError("DuplicateError")<{ entity: string; field: string }> {}
export class PaymentNotFound extends Data.TaggedError("PaymentNotFound")<{ id: string }> {}
export class ReceiptBlockedError extends Data.TaggedError("ReceiptBlockedError")<{ missing: string[] }> {}
export class NotificationNotFound extends Data.TaggedError("NotificationNotFound")<{ id: string }> {}
export class CreditorNotFound extends Data.TaggedError("CreditorNotFound")<{ id: string }> {}
export class InvestmentNotFound extends Data.TaggedError("InvestmentNotFound")<{ id: string }> {}
export class CategoryInUseError extends Data.TaggedError("CategoryInUseError")<{ categoryId: string }> {}
export class SnapshotNotFound extends Data.TaggedError("SnapshotNotFound")<{ period: string }> {}
export class CategoryNotFound extends Data.TaggedError("CategoryNotFound")<{ id: string }> {}
export class TransactionNotFound extends Data.TaggedError("TransactionNotFound")<{ id: string }> {}
