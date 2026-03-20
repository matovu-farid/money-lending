import { Effect } from "effect"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
import { DatabaseError, CustomerNotFound } from "@/lib/errors"
import type { CreateCustomerInput, UpdateCustomerInput } from "@/types"
import type { Customer } from "@/types"

export const createCustomer = (
  input: CreateCustomerInput
): Effect.Effect<Customer, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(customers)
        .values({
          fullName: input.fullName,
          contact: input.contact,
          address: input.address,
        })
        .returning()
        .then((rows) => rows[0]),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getCustomer = (
  id: string
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.select().from(customers).where(eq(customers.id, id)),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new CustomerNotFound({ id }))
    )
  )

export const updateCustomer = (
  id: string,
  input: UpdateCustomerInput
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(customers)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning()
        .then((rows) => rows[0]),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((row) =>
      row
        ? Effect.succeed(row)
        : Effect.fail(new CustomerNotFound({ id }))
    )
  )

export const listCustomers = (): Effect.Effect<Customer[], DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(customers),
    catch: (e) => new DatabaseError({ cause: e }),
  })
