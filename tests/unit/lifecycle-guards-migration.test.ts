// db/migrations/0030_lifecycle_guards.sql, read as text. The live checks run against a Neon branch:
// tests/integration/community-rls.test.ts (legacy grants), complaint-review-system-rls.test.ts
// (expected status) and review-moderation-rls.test.ts (corrections follow a rollback).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const strip = (s: string) => s.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const read = (file: string) => strip(readFileSync(path.resolve("db/migrations", file), "utf8"));
const SQL = read("0030_lifecycle_guards.sql");
const fn = (sql: string, name: string) => {
  const m = new RegExp(`create or replace function ${name.replace(".", "\\.")}\\(([\\s\\S]*?)\\)\\s*returns[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql);
  if (!m) throw new Error(`${name} not found`);
  return { args: m[1]!, head: m[0].slice(0, m[0].indexOf("$$")), body: m[2]! };
};
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("0030: legacy reviewer functions are closed to the app, not dropped", () => {
  for (const sig of ["community.set_correction_status(uuid, text, text, text)", "community.set_content_status(text, uuid, text, text)"]) {
    it(sig, () => {
      expect(SQL).toContain(`revoke execute on function ${sig} from paranaga_app;`);
      expect(SQL).toContain(`revoke execute on function ${sig} from public;`);
    });
  }
  it("drops nothing but the old complaint-status signature, and changes no table", () => {
    expect([...SQL.matchAll(/drop [^;]+;/g)].map((m) => m[0])).toEqual(["drop function if exists priv.set_complaint_status(uuid, text, text, text, text);"]);
    expect(SQL).not.toMatch(/\b(create|alter|drop) (table|index|policy|trigger)\b/);
  });
});

describe("0030: priv.set_complaint_status", () => {
  const next = fn(SQL, "priv.set_complaint_status");
  const prev = fn(read("0018_priv_complaint.sql"), "priv.set_complaint_status");
  const check =
    "if p_expected_status is not null and v_from is distinct from p_expected_status then raise exception 'this report changed since the page was loaded; reload and try again' using errcode = '55000'; end if;";

  it("adds one optional last parameter and keeps the rest of the header (definer, search_path)", () => {
    expect(squash(next.args)).toBe(`${squash(prev.args)}, p_expected_status text default null`);
    expect(squash(next.head.replace(next.args, ""))).toBe(squash(prev.head.replace(prev.args, "")));
  });

  it("is the 0018 body plus the expected-status check, after the row lock and the own-report rule", () => {
    expect(squash(next.body).replace(` ${check}`, "")).toBe(squash(prev.body));
    const body = squash(next.body);
    expect(body.indexOf("for update;")).toBeLessThan(body.indexOf(check));
    expect(body.indexOf("forbidden: own report")).toBeLessThan(body.indexOf(check));
    expect(body.indexOf(check)).toBeLessThan(body.indexOf("invalid transition"));
  });

  it("uses the same conflict error as community.admin_review_correction (0025)", () => {
    expect(squash(fn(read("0025_review_moderation.sql"), "community.admin_review_correction").body)).toContain(
      "raise exception 'this report changed since the page was loaded; reload and try again' using errcode = '55000';",
    );
  });

  it("re-applies owner and grants on the new signature", () => {
    const sig = "priv\\.set_complaint_status\\(uuid, text, text, text, text, text\\)";
    expect(SQL).toMatch(new RegExp(`alter function ${sig} owner to paranaga_definer;`));
    expect(SQL).toMatch(new RegExp(`revoke execute on function ${sig} from public;`));
    expect(SQL).toMatch(new RegExp(`grant execute on function ${sig} to paranaga_app;`));
  });
});

describe("0030: community.incorporate_corrections", () => {
  const next = fn(SQL, "community.incorporate_corrections");
  const prev = fn(read("0025_review_moderation.sql"), "community.incorporate_corrections");

  it("keeps the header and the draft-publication branch of 0025", () => {
    expect(squash(next.head)).toBe(squash(prev.head));
    const draftBranch = squash(prev.body).match(/if new\.status = 'published'.*?from done d;/)![0];
    expect(squash(next.body)).toContain(draftBranch);
  });

  it("acts on a re-published (superseded) revision only, and never casts draft_change", () => {
    const body = squash(next.body);
    expect(body).toContain("elsif new.status = 'published' and old.status = 'superseded' then");
    expect(body).toContain("set status = 'accepted', incorporated_revision_id = null");
    expect(body).toContain("'incorporated', 'accepted', core.current_user_id(), 'publication', 'publication_rolled_back'");
    expect(body).not.toMatch(/draft_change ->> '\w+'\)?::/);
  });

  it("stays owned by paranaga_definer, closed to public, with no app grant", () => {
    expect(SQL).toContain("alter function community.incorporate_corrections() owner to paranaga_definer;");
    expect(SQL).toContain("revoke execute on function community.incorporate_corrections() from public;");
    expect(SQL).not.toMatch(/grant execute on function community\.incorporate_corrections/);
  });
});
