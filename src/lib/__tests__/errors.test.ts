import { describe, it, expect } from "vitest"
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  ValidationError,
  IncompleteLoanRequirements,
  UnauthorizedError,
  ForbiddenError,
  DuplicateError,
  PaymentNotFound,
  ReceiptBlockedError,
  NotificationNotFound,
  CreditorNotFound,
  InvestmentNotFound,
  CategoryInUseError,
  SnapshotNotFound,
  CategoryNotFound,
  TransactionNotFound,
} from "../errors"

describe("Tagged Errors", () => {
  it("DatabaseError has correct tag and cause", () => {
    const err = new DatabaseError({ cause: "connection failed" })
    expect(err._tag).toBe("DatabaseError")
    expect(err.cause).toBe("connection failed")
  })

  it("CustomerNotFound has correct tag and id", () => {
    const err = new CustomerNotFound({ id: "cust-1" })
    expect(err._tag).toBe("CustomerNotFound")
    expect(err.id).toBe("cust-1")
  })

  it("LoanNotFound has correct tag and id", () => {
    const err = new LoanNotFound({ id: "loan-1" })
    expect(err._tag).toBe("LoanNotFound")
    expect(err.id).toBe("loan-1")
  })

  it("ValidationError has correct tag, message, and optional field", () => {
    const err = new ValidationError({ message: "invalid amount", field: "amount" })
    expect(err._tag).toBe("ValidationError")
    expect(err.message).toBe("invalid amount")
    expect(err.field).toBe("amount")
  })

  it("ValidationError works without optional field", () => {
    const err = new ValidationError({ message: "bad input" })
    expect(err._tag).toBe("ValidationError")
    expect(err.field).toBeUndefined()
  })

  it("IncompleteLoanRequirements has correct tag and missing array", () => {
    const err = new IncompleteLoanRequirements({ missing: ["collateral", "guarantor"] })
    expect(err._tag).toBe("IncompleteLoanRequirements")
    expect(err.missing).toEqual(["collateral", "guarantor"])
  })

  it("UnauthorizedError has correct tag and reason", () => {
    const err = new UnauthorizedError({ reason: "not logged in" })
    expect(err._tag).toBe("UnauthorizedError")
    expect(err.reason).toBe("not logged in")
  })

  it("ForbiddenError has correct tag, action, and role", () => {
    const err = new ForbiddenError({ action: "delete", role: "viewer" })
    expect(err._tag).toBe("ForbiddenError")
    expect(err.action).toBe("delete")
    expect(err.role).toBe("viewer")
  })

  it("DuplicateError has correct tag, entity, and field", () => {
    const err = new DuplicateError({ entity: "customer", field: "email" })
    expect(err._tag).toBe("DuplicateError")
    expect(err.entity).toBe("customer")
    expect(err.field).toBe("email")
  })

  it("PaymentNotFound has correct tag and id", () => {
    const err = new PaymentNotFound({ id: "pay-1" })
    expect(err._tag).toBe("PaymentNotFound")
    expect(err.id).toBe("pay-1")
  })

  it("ReceiptBlockedError has correct tag and missing array", () => {
    const err = new ReceiptBlockedError({ missing: ["signature"] })
    expect(err._tag).toBe("ReceiptBlockedError")
    expect(err.missing).toEqual(["signature"])
  })

  it("NotificationNotFound has correct tag and id", () => {
    const err = new NotificationNotFound({ id: "notif-1" })
    expect(err._tag).toBe("NotificationNotFound")
    expect(err.id).toBe("notif-1")
  })

  it("CreditorNotFound has correct tag and id", () => {
    const err = new CreditorNotFound({ id: "cred-1" })
    expect(err._tag).toBe("CreditorNotFound")
    expect(err.id).toBe("cred-1")
  })

  it("InvestmentNotFound has correct tag and id", () => {
    const err = new InvestmentNotFound({ id: "inv-1" })
    expect(err._tag).toBe("InvestmentNotFound")
    expect(err.id).toBe("inv-1")
  })

  it("CategoryInUseError has correct tag and categoryId", () => {
    const err = new CategoryInUseError({ categoryId: "cat-1" })
    expect(err._tag).toBe("CategoryInUseError")
    expect(err.categoryId).toBe("cat-1")
  })

  it("SnapshotNotFound has correct tag and period", () => {
    const err = new SnapshotNotFound({ period: "2026-03" })
    expect(err._tag).toBe("SnapshotNotFound")
    expect(err.period).toBe("2026-03")
  })

  it("CategoryNotFound has correct tag and id", () => {
    const err = new CategoryNotFound({ id: "cat-2" })
    expect(err._tag).toBe("CategoryNotFound")
    expect(err.id).toBe("cat-2")
  })

  it("TransactionNotFound has correct tag and id", () => {
    const err = new TransactionNotFound({ id: "txn-1" })
    expect(err._tag).toBe("TransactionNotFound")
    expect(err.id).toBe("txn-1")
  })

  it("all errors are instanceof Error", () => {
    const errors = [
      new DatabaseError({ cause: "x" }),
      new CustomerNotFound({ id: "x" }),
      new LoanNotFound({ id: "x" }),
      new ValidationError({ message: "x" }),
      new IncompleteLoanRequirements({ missing: [] }),
      new UnauthorizedError({ reason: "x" }),
      new ForbiddenError({ action: "x", role: "x" }),
      new DuplicateError({ entity: "x", field: "x" }),
      new PaymentNotFound({ id: "x" }),
      new ReceiptBlockedError({ missing: [] }),
      new NotificationNotFound({ id: "x" }),
      new CreditorNotFound({ id: "x" }),
      new InvestmentNotFound({ id: "x" }),
      new CategoryInUseError({ categoryId: "x" }),
      new SnapshotNotFound({ period: "x" }),
      new CategoryNotFound({ id: "x" }),
      new TransactionNotFound({ id: "x" }),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error)
    }
  })
})
