import { Data } from "effect"

export class DatabaseError extends Data.TaggedError("DatabaseError")<{ cause: unknown }> {}
export class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{ id: string }> {}
export class LoanNotFound extends Data.TaggedError("LoanNotFound")<{ id: string }> {}
export class ValidationError extends Data.TaggedError("ValidationError")<{ message: string; field?: string }> {}
export class IncompleteLoanRequirements extends Data.TaggedError("IncompleteLoanRequirements")<{ missing: string[] }> {}
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{ reason: string }> {}
export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{ action: string; role: string }> {}
export class DuplicateError extends Data.TaggedError("DuplicateError")<{ entity: string; field: string }> {}
