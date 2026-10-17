// db/migrations/0019_mynaga_handoff.sql, read as text (task B9). Pins the access model so a careless
// edit fails locally without a database: owner-only, forced RLS, definer-only writes, no moderator.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAW = readFileSync(path.resolve("db/migrations/0019_mynaga_handoff.sql"), "utf8").replace(/\r\n/g, "\n");
const SQL = RAW.replace(/--[^\n]*/g, "");

describe("0019: priv.external_handoff", () => {
  it("enables and forces row level security", () => {
    expect(SQL).toMatch(/alter table priv\.external_handoff\s+enable row level security;/);
    expect(SQL).toMatch(/alter table priv\.external_handoff\s+force row level security;/);
  });

  it("lets paranaga_app read only the owner row and write nothing", () => {
    const policy = /create policy external_handoff_owner_read on priv\.external_handoff for select to paranaga_app([\s\S]*?);/.exec(SQL)?.[1] ?? "";
    expect(policy).toContain("c.reporter_id = (select core.current_user_id())");
    const appGrants = [...SQL.matchAll(/grant ([^;]*?) on priv\.external_handoff to paranaga_app;/g)].map((m) => m[1]!);
    expect(appGrants).toHaveLength(1);
    expect(appGrants[0]).toMatch(/^select\b/);
    expect(appGrants[0]!.replace(/\([^)]*\)/, "")).not.toMatch(/insert|update|delete|all/);
  });

  it("names no moderator, reviewer or admin role anywhere", () => {
    expect(SQL).not.toMatch(/community_moderator|transport_reviewer|complaint_reviewer|has_role|'admin'/);
  });

  it("writes only through a definer function that takes the user from the request context", () => {
    const fn = /create or replace function priv\.set_mynaga_handoff\([\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(SQL)?.[0] ?? "";
    expect(fn).toContain("security definer");
    expect(fn).toMatch(/set search_path = pg_catalog,[^\n]*pg_temp\n/);
    expect(fn).toContain("v_user_id text := core.current_user_id()");
    expect(fn).not.toMatch(/p_user|p_reporter/);
    expect(fn).toContain("c.reporter_id = v_user_id");
    expect(SQL).toMatch(/alter function priv\.set_mynaga_handoff\(uuid, boolean, text\) owner to paranaga_definer;/);
    expect(SQL).toMatch(/revoke execute on function priv\.set_mynaga_handoff\(uuid, boolean, text\) from public;/);
  });

  it("audits without the reference", () => {
    const audit = /perform core\.audit\(([^;]*)\);/.exec(SQL)?.[1] ?? "";
    expect(audit).not.toMatch(/reference|v_ref|p_reference/);
  });

  it("bounds the reference to 64 characters at the table and in the function", () => {
    expect(SQL).toContain("char_length(self_reported_reference) between 1 and 64");
    expect(SQL).toContain("char_length(v_ref) > 64");
  });

  it("gives create on priv to the definer only for the length of the migration", () => {
    expect(SQL.indexOf("grant create on schema priv to paranaga_definer;")).toBeGreaterThanOrEqual(0);
    expect(SQL.trimEnd().endsWith("revoke create on schema priv from paranaga_definer;")).toBe(true);
  });
});
