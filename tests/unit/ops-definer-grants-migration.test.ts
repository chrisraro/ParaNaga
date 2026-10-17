import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("db/migrations/0021_ops_definer_grants.sql", "utf8");
const fn0014 = readFileSync("db/migrations/0014_ops_ratelimit_jobs.sql", "utf8");

describe("0021 ops definer grants", () => {
  it("covers every ops table the 0014 definer functions touch", () => {
    const touched = new Set([...fn0014.matchAll(/\b(?:from|into|update)\s+(ops\.[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
    expect(touched).toEqual(new Set(["ops.rate_limit_bucket", "ops.job"]));
    for (const table of touched) expect(sql).toContain(`on ${table} to paranaga_definer`);
  });

  it("gives the definer a row-level-security policy on each (RLS is forced there)", () => {
    expect(sql).toMatch(/create policy rate_limit_definer on ops\.rate_limit_bucket for all to paranaga_definer/);
    expect(sql).toMatch(/create policy job_definer_read on ops\.job for select to paranaga_definer/);
    expect(sql).toMatch(/create policy job_definer_update on ops\.job for update to paranaga_definer/);
  });

  it("grants the job table only select and update", () => {
    expect(sql).toMatch(/grant select, update on ops\.job to paranaga_definer/);
    expect(sql).not.toMatch(/grant [^;]*insert[^;]* on ops\.job/);
  });
});
