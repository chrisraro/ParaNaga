import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { BEGIN_READ_ONLY, runInRequestContext } from "@/server/db/run-in-context";

function fakePool() {
  const statements: string[] = [];
  let released = 0;
  const client = {
    query: async (text: string) => {
      statements.push(text);
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      released += 1;
    },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, statements, released: () => released };
}

const ctx = { userId: null, requestId: "req-1" };

describe("runInRequestContext", () => {
  it("opens a plain transaction by default", async () => {
    const { pool, statements, released } = fakePool();
    await runInRequestContext(pool, ctx, async () => "x");
    expect(statements[0]).toBe("begin");
    expect(statements[1]).toMatch(/set_config\('app.user_id'/);
    expect(statements.at(-1)).toBe("commit");
    expect(released()).toBe(1);
  });

  it("readOnly opens one REPEATABLE READ, READ ONLY transaction before setting context", async () => {
    const { pool, statements } = fakePool();
    await runInRequestContext(pool, ctx, async () => "x", { readOnly: true });
    expect(BEGIN_READ_ONLY).toBe("begin isolation level repeatable read read only");
    expect(statements[0]).toBe(BEGIN_READ_ONLY);
    expect(statements[1]).toMatch(/set_config/);
    expect(statements.filter((s) => /^begin/.test(s))).toHaveLength(1);
  });

  it("rolls back and releases on failure", async () => {
    const { pool, statements, released } = fakePool();
    await expect(runInRequestContext(pool, ctx, async () => { throw new Error("boom"); }, { readOnly: true }))
      .rejects.toThrow("boom");
    expect(statements.at(-1)).toBe("rollback");
    expect(released()).toBe(1);
  });
});
