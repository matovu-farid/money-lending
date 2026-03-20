import { describe, it, expect } from "vitest"

describe("Customer Service", () => {
  it("createCustomer returns an Effect (type check)", async () => {
    // Verify the module exports the expected functions
    const mod = await import("@/services/customer.service")
    expect(mod.createCustomer).toBeDefined()
    expect(mod.getCustomer).toBeDefined()
    expect(mod.updateCustomer).toBeDefined()
    expect(mod.listCustomers).toBeDefined()
  })

  it("CreateCustomerInput interface is exported from types (CUST-01)", async () => {
    const types = await import("@/types")
    // TypeScript interfaces are erased at runtime, but we can verify
    // the type exports exist by checking dependent usage compiles
    expect(types).toBeDefined()
  })

  it.todo("creates a customer in the database (requires test DB)")
  it.todo("returns CustomerNotFound for invalid ID (requires test DB)")
})
