import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn(() => {
  throw new Error("Unsafe database command reached execute");
}));

vi.mock("@/lib/db", () => ({ db: { execute } }));

import { resetDb } from "../__integration__/setup";

afterEach(() => {
  vi.unstubAllEnvs();
  execute.mockClear();
});

describe("integration reset safety", () => {
  it("rejects a production DATABASE_URL before executing destructive SQL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://owner:secret@production.neon.tech/neondb");
    vi.stubEnv("INTEGRATION_TEST_DATABASE_URL", "postgres://owner:secret@localhost/money_lending_integration_test");

    await expect(resetDb()).rejects.toThrow(/isolated integration database/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects the general local development database before executing destructive SQL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://owner:secret@localhost/money_lending");
    vi.stubEnv("INTEGRATION_TEST_DATABASE_URL", "postgres://owner:secret@localhost/money_lending");

    await expect(resetDb()).rejects.toThrow(/isolated integration database/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
