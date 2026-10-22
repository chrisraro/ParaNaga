// db/migrations/0022_step_up.sql, read as text (N3). The live checks run in
// tests/integration/step-up-rls.test.ts against a migrated Neon branch.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(path.resolve("db/migrations/0022_step_up.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");
const fn = (name: string) => {
  const m = new RegExp(`create or replace function ${name.replace(".", "\\.")}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`).exec(SQL);
  if (!m) throw new Error(`function ${name} not found`);
  return m[0];
};

describe("0022: core.step_up", () => {
  it("is private to definer functions: RLS forced, no grant to paranaga_app, rows scoped to the caller", () => {
    expect(SQL).toMatch(/alter table core\.step_up enable row level security;/);
    expect(SQL).toMatch(/alter table core\.step_up force row level security;/);
    expect(SQL).not.toMatch(/grant [^;]* on core\.step_up to paranaga_app/);
    expect(SQL).toMatch(/create policy step_up_definer_own on core\.step_up for all to paranaga_definer\s+using \(user_id = core\.current_user_id\(\)\)\s+with check \(user_id = core\.current_user_id\(\)\);/);
  });

  it("stores a session hash, never a code", () => {
    expect(SQL).toContain("session_key   text not null check (session_key ~ '^[0-9a-f]{64}$')");
    expect(SQL).not.toMatch(/\b(otp|code)\s+text/);
  });
});

describe("0022: the functions", () => {
  it("apply sets app.step_up_at transaction-locally, only from a verification under 15 minutes old", () => {
    const body = fn("core.step_up_apply");
    expect(body).toContain("s.user_id = core.current_user_id() and s.session_key = p_session_key");
    expect(body).toContain("s.verified_at > now() - interval '15 minutes'");
    expect(body).toContain("perform set_config('app.step_up_at', coalesce(v_at::text, ''), true);");
  });

  it("finish records a verification only for an open challenge, closes it, and audits success and failure", () => {
    const body = fn("core.step_up_finish");
    expect(body).toMatch(/if p_ok is true then\s+update core\.step_up s\s+set verified_at = now\(\), challenged_at = null/);
    expect(body).toContain("s.challenged_at > now() - interval '10 minutes'");
    expect(body).toContain("core.audit('step_up.success'");
    expect(body).toContain("core.audit('step_up.failure'");
  });

  it("begin needs a signed-in caller and audits the request", () => {
    const body = fn("core.step_up_begin");
    expect(body).toContain("raise exception 'not authenticated' using errcode = '28000'");
    expect(body).toContain("core.audit('step_up.request'");
  });

  for (const sig of ["core.step_up_begin(text)", "core.step_up_pending(text)", "core.step_up_finish(text, boolean)", "core.step_up_apply(text)"]) {
    it(`${sig}: definer-owned, revoked from public, executable by paranaga_app`, () => {
      const esc = sig.replace(/[.()]/g, (c) => `\\${c}`);
      expect(SQL).toMatch(new RegExp(`alter function ${esc} owner to paranaga_definer;`));
      expect(SQL).toMatch(new RegExp(`revoke execute on function ${esc} from public;`));
      expect(SQL).toMatch(new RegExp(`grant execute on function ${esc} to paranaga_app;`));
    });
  }
});

describe("0022: the reporter's original download needs step-up (spec 05 §5.8)", () => {
  const body = fn("priv.my_evidence_download");
  it("checks step-up right after authentication, before the ownership lookup and the access record", () => {
    const gate = body.indexOf("perform priv.require_step_up();");
    expect(gate).toBeGreaterThan(body.indexOf("raise exception 'not authenticated'"));
    expect(gate).toBeLessThan(body.indexOf("from priv.complaint_media cm"));
    expect(gate).toBeLessThan(body.indexOf("insert into priv.evidence_access"));
  });

  it("keeps owner and grants", () => {
    expect(SQL).toContain("alter function priv.my_evidence_download(uuid, uuid) owner to paranaga_definer;");
    expect(SQL).toContain("grant execute on function priv.my_evidence_download(uuid, uuid) to paranaga_app;");
  });
});
