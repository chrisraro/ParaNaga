// db/migrations/0018_priv_complaint.sql, read as text (task B8). The live RLS matrix runs in
// tests/integration/priv-complaint-rls.test.ts against a migrated Neon branch (CI); this file
// pins the access model so a careless edit fails locally without a database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAW = readFileSync(path.resolve("db/migrations/0018_priv_complaint.sql"), "utf8").replace(/\r\n/g, "\n");
// Statements only: line comments removed, so prose in comments never satisfies or breaks a rule.
const SQL = RAW.replace(/--[^\n]*/g, "");
const PRIV_TABLES = ["complaint", "complaint_media", "complaint_event", "evidence_access"];

/** `create policy … on <table> … ;` statements. */
const policies = [...SQL.matchAll(/create policy (\w+) on ([\w.]+) for (\w+) to (\w+)([\s\S]*?);/g)].map((m) => ({
  name: m[1]!,
  table: m[2]!,
  command: m[3]!,
  role: m[4]!,
  body: m[5]!.replace(/\s+/g, " ").trim(),
}));
const grants = [...SQL.matchAll(/grant ([^;]*?) on ([^;]*?) to ([^;]+);/g)].map((m) => ({
  what: m[1]!.replace(/\s+/g, " "),
  on: m[2]!.replace(/\s+/g, " "),
  to: m[3]!.trim(),
}));
const fnBody = (name: string) => {
  const m = new RegExp(`create or replace function priv\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(SQL);
  if (!m) throw new Error(`function ${name} not found`);
  return m[0];
};

describe("0018: forced RLS on every priv table", () => {
  for (const t of PRIV_TABLES) {
    it(`priv.${t} enables and forces row level security`, () => {
      expect(SQL).toMatch(new RegExp(`alter table priv\\.${t}\\s+enable row level security;`));
      expect(SQL).toMatch(new RegExp(`alter table priv\\.${t}\\s+force row level security;`));
    });
  }
});

describe("0018: paranaga_app sees only the reporter's own rows", () => {
  const appPolicies = policies.filter((p) => p.table.startsWith("priv.") && p.role === "paranaga_app");

  it("has exactly one SELECT policy per readable table and none on evidence_access", () => {
    expect(appPolicies.map((p) => `${p.table}:${p.command}`).sort()).toEqual(
      ["priv.complaint:select", "priv.complaint_event:select", "priv.complaint_media:select"].sort(),
    );
  });

  it("keys every app policy to core.current_user_id() and no role", () => {
    for (const p of appPolicies) {
      expect(p.body, p.name).toContain("reporter_id = (select core.current_user_id())");
      expect(p.body, p.name).not.toMatch(/has_role/);
    }
    expect(appPolicies.find((p) => p.table === "priv.complaint_event")?.body).toContain("visibility = 'reporter'");
  });

  it("grants paranaga_app no write on priv and no access to the evidence log", () => {
    const appPriv = grants.filter((g) => g.to.includes("paranaga_app") && g.on.includes("priv."));
    for (const g of appPriv) {
      expect(g.what, g.on).not.toMatch(/\b(insert|update|delete|truncate|all)\b/);
      expect(g.on).not.toContain("evidence_access");
    }
    // Column grants leave out the routing queue, legal hold, storage keys and hashes.
    const complaintGrant = appPriv.find((g) => g.on === "priv.complaint")?.what ?? "";
    for (const hidden of ["queue", "legal_hold", "retention_until", "client_request_id", "incident_location"]) {
      expect(complaintGrant).not.toMatch(new RegExp(`\\b${hidden}\\b`));
    }
    const mediaGrant = appPriv.find((g) => g.on === "priv.complaint_media")?.what ?? "";
    expect(mediaGrant).not.toMatch(/original_key|redacted_key|sha256/);
    const eventGrant = appPriv.find((g) => g.on === "priv.complaint_event")?.what ?? "";
    expect(eventGrant).not.toMatch(/actor_id/);
  });

  it("never mentions community moderators, transport reviewers or admins in a grant or policy", () => {
    for (const p of policies) expect(p.body).not.toMatch(/community_moderator|transport_reviewer|'admin'/);
    expect(SQL).not.toMatch(/community_moderator/);
  });
});

describe("0018: definer functions", () => {
  const fns = ["submit_complaint", "my_evidence_download", "review_queue", "reviewer_evidence_download", "set_complaint_status"];

  for (const fn of fns) {
    it(`priv.${fn} pins search_path, is owned by paranaga_definer and not executable by PUBLIC`, () => {
      const body = fnBody(fn);
      expect(body).toContain("security definer");
      expect(body).toMatch(/set search_path = pg_catalog,[^\n]*pg_temp\n/);
      expect(SQL).toMatch(new RegExp(`alter function priv\\.${fn}\\([^)]*\\) owner to paranaga_definer;`));
      expect(SQL).toMatch(new RegExp(`revoke execute on function priv\\.${fn}\\([^)]*\\) from public;`));
    });
  }

  it("submit_complaint takes the reporter from the request context, never from an argument", () => {
    const body = fnBody("submit_complaint");
    expect(body).toContain("v_user_id text := core.current_user_id()");
    expect(body).not.toMatch(/p_reporter|p_user/);
    expect(body).toContain("raise exception 'not authenticated' using errcode = '28000'");
  });

  it("submit_complaint accepts only the caller's own verified evidence in the private bucket, once", () => {
    const body = fnBody("submit_complaint");
    for (const rule of [
      "m.owner_id = v_user_id",
      "m.purpose = 'complaint_evidence'",
      "m.status = 'verified'",
      "m.bucket = 'evidence-private'",
      "not exists (select 1 from priv.complaint_media cm where cm.media_object_id = m.id)",
    ]) {
      expect(body).toContain(rule);
    }
    expect(body).toContain("v_count > 3");
  });

  it("submit_complaint audits without any report text", () => {
    const audit = /perform core\.audit\(([^;]*)\);/.exec(fnBody("submit_complaint"))?.[1] ?? "";
    expect(audit).not.toMatch(/description|plate|operator|location|body_number/);
  });

  it("my_evidence_download answers only the reporter and logs each issuance for at most 60 s", () => {
    const body = fnBody("my_evidence_download");
    expect(body).toContain("c.reporter_id = v_user_id");
    expect(body).toContain("insert into priv.evidence_access");
    expect(body).toContain("interval '60 seconds'");
    expect(SQL).toContain("check (expires_at > issued_at and expires_at <= issued_at + interval '60 seconds')");
  });

  for (const fn of ["review_queue", "reviewer_evidence_download", "set_complaint_status"]) {
    it(`${fn} requires the complaint_reviewer role and a fresh step-up, and never the reviewer's own report`, () => {
      const body = fnBody(fn);
      expect(body).toContain("core.has_role('complaint_reviewer')");
      expect(body).not.toMatch(/has_role\('(admin|community_moderator|transport_reviewer)'\)/);
      expect(body).toContain("perform priv.require_step_up();");
      expect(body).toMatch(/reporter_id <> core\.current_user_id\(\)|v_reporter = v_(user_id|actor)/);
      expect(body).not.toMatch(/select[^;]*\breporter_id\b[^;]*from priv\.complaint c\s+where c\.status/);
    });
  }

  it("the review queue never returns reporter_id", () => {
    const returns = /returns table \(([\s\S]*?)\)\n/.exec(fnBody("review_queue"))?.[1] ?? "";
    expect(returns).not.toContain("reporter_id");
  });

  it("step-up fails closed when nothing set it, and expires after 15 minutes", () => {
    const m = /create or replace function priv\.require_step_up\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(SQL)?.[1] ?? "";
    expect(m).toContain("current_setting('app.step_up_at', true)");
    expect(m).toContain("if v_raw is null then");
    expect(m).toContain("interval '15 minutes'");
    expect(SQL).toContain("revoke execute on function priv.require_step_up() from public;");
  });
});

// The matrix the policies above encode, evaluated for each actor. A row is readable by
// paranaga_app only when reporter_id equals the request's user id; no role widens it.
describe("0018: access matrix (guest, owner, other commuter, community moderator, complaint reviewer)", () => {
  const appSelect = policies.find((p) => p.table === "priv.complaint" && p.role === "paranaga_app")!;
  const reads = (userId: string | null, reporterId: string) => {
    expect(appSelect.body).toBe("using (reporter_id = (select core.current_user_id()))");
    return userId !== null && userId === reporterId;
  };
  const cases: [string, string | null, boolean][] = [
    ["guest", null, false],
    ["owner", "u-owner", true],
    ["other commuter", "u-other", false],
    ["community moderator", "u-mod", false],
    ["complaint reviewer (direct table read)", "u-rev", false],
  ];
  for (const [name, userId, expected] of cases) {
    it(`${name}: ${expected ? "reads" : "is denied"}`, () => {
      expect(reads(userId, "u-owner")).toBe(expected);
    });
  }
});

describe("0018: core.media_object definer access stays narrow", () => {
  it("lets definer functions create the caller's own slot, read media rows and only promote or reject a slot", () => {
    const read = policies.find((p) => p.name === "media_definer_read");
    const promote = policies.find((p) => p.name === "media_definer_promote");
    expect(read).toMatchObject({ table: "core.media_object", command: "select", role: "paranaga_definer" });
    expect(promote).toMatchObject({ table: "core.media_object", command: "update", role: "paranaga_definer" });
    expect(promote?.body).toContain("using (status = 'slot')");
    expect(promote?.body).toContain("with check (status in ('verified', 'rejected'))");
    expect(grants.find((g) => g.on === "core.media_object" && g.what.startsWith("update"))?.what).not.toMatch(/owner_id|purpose/);
    const slot = policies.find((p) => p.name === "media_definer_slot");
    expect(slot).toMatchObject({ table: "core.media_object", command: "insert", role: "paranaga_definer" });
    expect(slot?.body).toContain("owner_id = core.current_user_id() and status = 'slot'");
  });
});

// Step-up itself (the record that fills app.step_up_at, and the reporter's original download gate)
// is migration 0022 (N3): tests/unit/step-up-migration.test.ts and tests/integration/step-up-rls.test.ts.
