// db/migrations/0023_admin_revisions.sql read as text (N5a). Pins the access model without a
// database: every admin function checks the role itself, publish needs step-up, the definer role
// has a grant AND a row-level-security policy on every table these functions touch (0014 forgot
// them once), and only paranaga_app may call them. The live checks are scripts/check-rls.ts and
// tests/integration/admin-revisions-rls.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve("db/migrations");
const strip = (s: string) => s.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const SQL = strip(readFileSync(path.join(DIR, "0023_admin_revisions.sql"), "utf8"));
const ALL = readdirSync(DIR)
  .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
  .sort()
  .map((f) => ({ file: f, sql: strip(readFileSync(path.join(DIR, f), "utf8")) }));

const fns = [...SQL.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/g)].map((m) => ({
  name: m[1]!,
  header: m[3]!,
  body: m[4]!,
}));
const fn = (name: string) => fns.find((f) => f.name === name)!;
const definers = fns.filter((f) => /security definer/.test(f.header));
const ADMIN_FNS = [
  "transit.admin_dashboard",
  "transit.admin_revisions",
  "transit.admin_create_draft",
  "transit.admin_validation_facts",
  "transit.admin_record_validation",
  "transit.admin_publish_revision",
  "transit.admin_coverage",
];

describe("0023: admin definer functions", () => {
  it("defines exactly the admin functions as SECURITY DEFINER", () => {
    expect(definers.map((f) => f.name).sort()).toEqual([...ADMIN_FNS].sort());
  });

  for (const name of ADMIN_FNS) {
    it(`${name}: checks the role in the database, pins search_path, owned by the definer, app-only`, () => {
      const f = fn(name);
      expect(f.body).toContain("transit.admin_assert_staff()");
      expect(f.header).toMatch(/set search_path = pg_catalog,[\w, ]*pg_temp\s/);
      expect(SQL).toMatch(new RegExp(`alter function ${name.replace(".", "\\.")}\\([^)]*\\) owner to paranaga_definer;`));
      expect(SQL).toMatch(new RegExp(`revoke execute on function ${name.replace(".", "\\.")}\\([^)]*\\) from public;`));
      const grants = [...SQL.matchAll(new RegExp(`grant execute on function ${name.replace(".", "\\.")}\\([^)]*\\) to ([\\w, ]+);`, "g"))].map((m) => m[1]!.trim());
      expect(grants).toEqual(["paranaga_app"]);
    });
  }

  it("the staff check accepts admin and transport_reviewer only and fails closed", () => {
    const f = fn("transit.admin_assert_staff");
    expect(f.header).not.toContain("security definer");
    expect(f.body).toContain("v_user is null or not (core.has_role('admin') or core.has_role('transport_reviewer'))");
    expect(f.body).toContain("errcode = '42501'");
    expect(SQL).not.toMatch(/grant execute on function transit\.admin_assert_staff/);
    expect(SQL).not.toMatch(/grant execute on function transit\.revision_membership_hash/);
  });

  it("publish requires step-up, the pointer the caller saw, a current validation, then calls publish_revision", () => {
    const b = fn("transit.admin_publish_revision").body;
    const order = ["priv.require_step_up()", "p_expected_published", "membershipHash", "interval '30 minutes'", "publish_requires_second_reviewer", "perform transit.publish_revision(p_revision)"];
    const at = order.map((s) => b.indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(b).toContain("pg_advisory_xact_lock(hashtext('transit.publish_revision'))");
  });

  it("the validation dry run is always rolled back (sentinel exception in a subtransaction)", () => {
    const b = fn("transit.admin_validation_facts").body;
    expect(b).toMatch(/begin\s+perform transit\.publish_revision\(p_revision\);\s+raise exception 'paranaga:dry-run' using errcode = 'P0001';\s+exception/);
  });

  it("the stored report is bound to the membership it was computed on", () => {
    const b = fn("transit.admin_record_validation").body;
    expect(b).toContain("p_membership_hash is distinct from transit.revision_membership_hash(p_revision)");
  });
});

/** Tables a function body reads or writes. */
function touched(body: string): Set<string> {
  return new Set([...body.matchAll(/\b(?:from|join|into|update)\s+((?:transit|core|community|ingest|ops|priv)\.[a-z_]+)\b(?!\s*\()/gi)].map((m) => m[1]!.toLowerCase()));
}

/** A grant to paranaga_definer on the table, in any migration (0001's "all tables in schema transit" covers its own tables). */
function definerGrant(table: string): boolean {
  const created0001 = new RegExp(`create table ${table.replace(".", "\\.")}\\s`).test(ALL.find((m) => m.file.startsWith("0001_"))!.sql);
  if (table.startsWith("transit.") && created0001) return true;
  const esc = table.replace(".", "\\.");
  return ALL.some((m) => new RegExp(`grant [^;]*\\bon\\s+(?:[\\w.]+,\\s*)*${esc}\\b[^;]*\\bto\\s+[^;]*paranaga_definer`).test(m.sql));
}

/** A policy for paranaga_definer on the table (a plain create policy or a do-block loop listing it). */
function definerPolicy(table: string): boolean {
  const esc = table.replace(".", "\\.");
  return ALL.some(
    (m) =>
      new RegExp(`create policy \\w+ on ${esc}\\s[^;]*to [^;]*paranaga_definer`).test(m.sql) ||
      [...m.sql.matchAll(/do \$\$([\s\S]*?)\$\$;/g)].some((d) => d[1]!.includes(`'${table}'`) && /to paranaga_definer/.test(d[1]!)),
  );
}

describe("0023: the definer can reach every table its functions touch", () => {
  const tables = new Set(fns.flatMap((f) => [...touched(f.body)]));
  it("finds the tables (guards against a regex that matches nothing)", () => {
    for (const t of ["transit.revision", "transit.revision_member", "transit.published_pointer", "community.correction", "ingest.batch", "ops.feature_flag"]) {
      expect(tables.has(t), t).toBe(true);
    }
  });
  for (const t of tables) {
    it(`${t}: grant and policy for paranaga_definer`, () => {
      expect(definerGrant(t), "grant").toBe(true);
      expect(definerPolicy(t), "policy").toBe(true);
    });
  }

  it("writes: draft revisions and their membership only, validation report only", () => {
    expect(SQL).toContain("grant insert (label, kind, status, created_by, parent_revision_id) on transit.revision to paranaga_definer;");
    expect(SQL).toContain("grant update (validation_report) on transit.revision to paranaga_definer;");
    expect(SQL).toMatch(/create policy definer_insert_draft on transit\.revision_member for insert to paranaga_definer\s+with check \(exists \(select 1 from transit\.revision r where r\.id = revision_id and r\.status = 'draft'\)\);/);
    expect(SQL).not.toMatch(/grant [^;]*(delete|truncate)[^;]*to paranaga_definer/);
  });

  it("gives schema CREATE to the definer only for the length of the migration", () => {
    expect(SQL.trimStart().startsWith("grant create on schema transit to paranaga_definer;")).toBe(true);
    expect(SQL.trimEnd().endsWith("revoke create on schema transit from paranaga_definer;")).toBe(true);
  });
});

// ================================================================ 0024 (N5b): stops, reconciliation, imports

const SQL24 = strip(readFileSync(path.join(DIR, "0024_admin_stops_imports.sql"), "utf8"));
const fns24 = [...SQL24.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/g)].map((m) => ({
  name: m[1]!,
  header: m[3]!,
  body: m[4]!,
}));
const fn24 = (name: string) => fns24.find((f) => f.name === name)!;
const esc = (s: string) => s.replace(/\./g, "\\.");
const N5B_FNS = [
  "transit.admin_stops",
  "transit.admin_promote_stop",
  "transit.admin_attach_stop_evidence",
  "transit.admin_retire_stop",
  "transit.admin_relocate_stop",
  "transit.admin_edit_stop",
  "transit.admin_reconciliation",
  "transit.admin_reconcile",
  "ingest.admin_import_batches",
  "ingest.admin_import_baseline",
  "ingest.admin_import_commit",
  "transit.admin_validation_facts",
];
const N5B_HELPERS = ["transit.admin_open_draft", "transit.admin_draft_stop", "transit.stop_status_rank", "transit.admin_copy_stop_version", "transit.admin_repoint_stop"];
const STOP_WRITES = ["transit.admin_promote_stop", "transit.admin_attach_stop_evidence", "transit.admin_retire_stop", "transit.admin_relocate_stop", "transit.admin_edit_stop", "transit.admin_reconcile"];

describe("0024: admin definer functions (N5b)", () => {
  it("defines exactly these SECURITY DEFINER functions; the helpers are invoker-rights", () => {
    expect(fns24.filter((f) => /security definer/.test(f.header)).map((f) => f.name).sort()).toEqual([...N5B_FNS].sort());
    expect(fns24.filter((f) => !/security definer/.test(f.header)).map((f) => f.name).sort()).toEqual([...N5B_HELPERS].sort());
  });

  for (const name of N5B_FNS) {
    it(`${name}: checks the role in the database, pins search_path, owned by the definer, app-only`, () => {
      const f = fn24(name);
      expect(f.body).toContain("transit.admin_assert_staff()");
      expect(f.header).toMatch(/set search_path = pg_catalog,[\w, ]*pg_temp\s/);
      expect(SQL24).toMatch(new RegExp(`alter function ${esc(name)}\\([^)]*\\) owner to paranaga_definer;`));
      expect(SQL24).toMatch(new RegExp(`revoke execute on function ${esc(name)}\\([^)]*\\) from public;`));
      const grants = [...SQL24.matchAll(new RegExp(`grant execute on function ${esc(name)}\\([^)]*\\) to ([\\w, ]+);`, "g"))].map((m) => m[1]!.trim());
      expect(grants).toEqual(["paranaga_app"]);
    });
  }

  for (const name of N5B_HELPERS) {
    it(`${name}: owned by the definer, not executable by PUBLIC or the app, search_path pinned`, () => {
      expect(fn24(name).header).toMatch(/set search_path = pg_catalog,[\w, ]*pg_temp\s/);
      expect(SQL24).toMatch(new RegExp(`alter function ${esc(name)}\\([^)]*\\) owner to paranaga_definer;`));
      expect(SQL24).toMatch(new RegExp(`revoke execute on function ${esc(name)}\\([^)]*\\) from public;`));
      expect(SQL24).not.toMatch(new RegExp(`grant execute on function ${esc(name)}\\(`));
    });
  }

  for (const name of STOP_WRITES) {
    it(`${name}: works on the open draft at the version the page saw, writes a new version and audits`, () => {
      const b = fn24(name).body;
      expect(b).toContain("transit.admin_draft_stop(");
      expect(b).toContain("transit.admin_repoint_stop(");
      expect(b).toMatch(/perform core\.audit\('stop\.\w+'/);
      expect(b).not.toMatch(/update transit\.stop_point_version|delete from/);
    });
  }

  it("the draft helper locks the open draft and refuses a stale version (55000) or an unknown stop (22023)", () => {
    expect(fn24("transit.admin_open_draft").body).toMatch(/where r\.status = 'draft' order by r\.seq desc limit 1 for update/);
    const b = fn24("transit.admin_draft_stop").body;
    expect(b).toContain("o_version is distinct from p_expected");
    expect(b).toContain("errcode = '55000'");
    expect(b).toContain("'unknown stop' using errcode = '22023'");
  });

  it("promotion checks evidence of the claimed kind before it writes; published is not offered", () => {
    const b = fn24("transit.admin_promote_stop").body;
    expect(b).toContain("p_status not in ('documentary', 'installed', 'field_verified')");
    expect(b.indexOf("l.claim = any (v_need)")).toBeGreaterThan(0);
    expect(b.indexOf("l.claim = any (v_need)")).toBeLessThan(b.indexOf("transit.admin_copy_stop_version("));
    expect(b).toContain("when 'documentary' then array['legal_designation']");
  });

  it("evidence photos are the caller's own verified stop_photo uploads; retire refuses stops in a stop order", () => {
    expect(fn24("transit.admin_attach_stop_evidence").body).toContain("mo.status = 'verified' and mo.purpose = 'stop_photo' and mo.owner_id = v_user");
    expect(fn24("transit.admin_retire_stop").body).toContain("change the route''s stops before retiring it");
    expect(fn24("transit.admin_edit_stop").body).toContain("l.claim = 'curb_position'");
    expect(fn24("transit.admin_relocate_stop").body).toContain("array['curb_position']");
  });

  it("repointing keeps publication's invariants: new variant and shape versions follow the new stop version", () => {
    const b = fn24("transit.admin_repoint_stop").body;
    for (const s of ["insert into transit.variant_version", "insert into transit.route_stop", "insert into transit.shape_version", "entity_kind = 'variant'", "entity_kind = 'shape'"]) {
      expect(b, s).toContain(s);
    }
  });

  it("the import recomputes the change kinds from the stored hashes and writes nothing when nothing changed (AC-1)", () => {
    const b = fn24("ingest.admin_import_commit").body;
    expect(b).toContain("b.content_hash = x.content_hash");
    expect(b).toContain("(p_plan ->> 'expectedBaselineBatchId')::uuid");
    const unchanged = b.indexOf("'outcome', 'unchanged'");
    expect(unchanged).toBeGreaterThan(0);
    expect(unchanged).toBeLessThan(b.indexOf("insert into"));
    expect(unchanged).toBeLessThan(b.indexOf("transit.admin_open_draft()"));
    expect(b).toContain("perform core.audit('import.commit'");
    expect(b).toContain("pg_advisory_xact_lock(hashtext(v_snapshot))");
  });

  it("validation facts keep every 0023 key and add the stop review fields", () => {
    const b = fn24("transit.admin_validation_facts").body;
    for (const k of ["'members'", "'stops'", "'terminals'", "'variants'", "'routeStops'", "'shapes'", "'dbCheck'", "'membershipHash'", "'status', spv.status", "'evidenceClaims'", "'movedM'", "'inSequence'"]) {
      expect(b, k).toContain(k);
    }
    expect(b).toMatch(/begin\s+perform transit\.publish_revision\(p_revision\);\s+raise exception 'paranaga:dry-run' using errcode = 'P0001';\s+exception/);
  });

  it("the public stop view reads the versioned name and keeps 0001's columns", () => {
    expect(SQL24).toMatch(/create or replace view transit\.v_published_stops with \(security_invoker = true\) as\s+select pp\.revision_id, sp\.id as stop_point_id, spv\.id as stop_point_version_id, coalesce\(spv\.name, sp\.name\) as name,/);
  });
});

/** Tables a 0024 function body reads (from/join/update) or inserts into. */
function tables24(body: string): { read: Set<string>; insert: Set<string>; update: Set<string> } {
  const t = (re: RegExp) => new Set([...body.matchAll(re)].map((m) => m[1]!.toLowerCase()));
  const S = "((?:transit|core|ingest|ops|priv|community)\\.[a-z_]+)";
  return {
    read: t(new RegExp(`\\b(?:from|join)\\s+${S}\\b(?!\\s*\\()`, "gi")),
    insert: t(new RegExp(`\\binsert into\\s+${S}\\b`, "gi")),
    update: t(new RegExp(`\\bupdate\\s+${S}\\b`, "gi")),
  };
}
const ALL_SQL = ALL.map((m) => m.sql).join("\n");
const grantFor = (verb: string, table: string) =>
  new RegExp(`grant\\s+[\\w\\s,()]*\\b${verb}\\b[\\w\\s,()]*\\bon\\s+(?:[\\w.]+,\\s*)*${esc(table)}\\b[^;]*\\bto\\s+[^;]*paranaga_definer`).test(ALL_SQL) ||
  (verb === "select" && table.startsWith("transit.") && definerGrant(table));
const policyFor = (verb: string, table: string) =>
  ALL.some(
    (m) =>
      new RegExp(`create policy \\w+ on ${esc(table)} (?:as permissive )?for (?:${verb}|all) to [\\w, ]*paranaga_definer`).test(m.sql) ||
      [...m.sql.matchAll(/do \$\$([\s\S]*?)\$\$;/g)].some((d) => d[1]!.includes(`'${table}'`) && new RegExp(`for (?:${verb}|all) to paranaga_definer`).test(d[1]!)),
  );

describe("0024: the definer can reach every table its functions touch, and writes only what it must", () => {
  const all = fns24.map((f) => tables24(f.body));
  const reads = new Set(all.flatMap((x) => [...x.read]));
  const inserts = new Set(all.flatMap((x) => [...x.insert]));
  const updates = new Set(all.flatMap((x) => [...x.update]));

  it("finds the tables (guards against a regex that matches nothing)", () => {
    for (const t of ["transit.evidence_link", "ingest.raw_feature", "transit.reconciliation_decision"]) expect(reads.has(t), t).toBe(true);
    for (const t of ["transit.stop_point_version", "transit.evidence", "ingest.batch", "transit.shape_version"]) expect(inserts.has(t), t).toBe(true);
    expect([...updates].sort()).toEqual(["ingest.batch", "transit.revision_member"]);
  });
  for (const t of reads) {
    it(`${t}: select grant and policy for paranaga_definer`, () => {
      expect(grantFor("select", t), "grant").toBe(true);
      expect(policyFor("select", t), "policy").toBe(true);
    });
  }
  for (const t of inserts) {
    it(`${t}: insert grant and policy for paranaga_definer`, () => {
      expect(grantFor("insert", t), "grant").toBe(true);
      expect(policyFor("insert", t), "policy").toBe(true);
    });
  }
  for (const t of updates) {
    it(`${t}: update grant and policy for paranaga_definer`, () => {
      expect(grantFor("update", t), "grant").toBe(true);
      expect(policyFor("update", t), "policy").toBe(true);
    });
  }

  it("membership: update of version_id in a draft only; no delete or truncate anywhere", () => {
    expect(SQL24).toContain("grant update (version_id) on transit.revision_member to paranaga_definer;");
    expect(SQL24).toMatch(/create policy definer_update_draft on transit\.revision_member for update to paranaga_definer\s+using \(exists \(select 1 from transit\.revision r where r\.id = revision_id and r\.status = 'draft'\)\)\s+with check \(exists/);
    expect(SQL24).not.toMatch(/grant [^;]*(delete|truncate)[^;]*to paranaga_definer/);
    expect(SQL24).not.toMatch(/grant [^;]*\bupdate\b[^;]*on transit\.(stop_point_version|variant_version|route_stop|shape_version|stop_point_source|evidence|evidence_link)\b/);
  });

  it("the new tables have RLS enabled and forced, and no grant to the app", () => {
    for (const t of ["transit.evidence", "transit.evidence_link", "transit.reconciliation_decision"]) {
      expect(SQL24, t).toContain(`alter table ${t} enable row level security;`);
      expect(SQL24, t).toContain(`alter table ${t} force row level security;`);
      expect(SQL24).not.toMatch(new RegExp(`grant [^;]*on [^;]*${esc(t)}\\b[^;]*to [^;]*paranaga_app`));
    }
    expect(SQL24).toContain("check (\n    num_nonnulls(stop_point_version_id, variant_version_id, shape_version_id, fare_rule_version_id, terminal_id) = 1)");
  });

  it("gives schema CREATE to the definer only for the length of the migration", () => {
    expect(SQL24.trimStart().startsWith("grant create on schema transit to paranaga_definer;\ngrant create on schema ingest to paranaga_definer;")).toBe(true);
    expect(SQL24.trimEnd().endsWith("revoke create on schema ingest from paranaga_definer;\nrevoke create on schema transit from paranaga_definer;")).toBe(true);
  });
});

// ================================================================ 0025 (N6): corrections review, moderation, appeals, photos

const SQL25 = strip(readFileSync(path.join(DIR, "0025_review_moderation.sql"), "utf8"));
const fns25 = [...SQL25.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/g)].map((m) => ({
  name: m[1]!,
  header: m[3]!,
  body: m[4]!,
}));
const fn25 = (name: string) => fns25.find((f) => f.name === name)!;
const CORRECTION_FNS = ["community.admin_corrections", "community.admin_review_correction"];
const MODERATION_FNS = ["community.admin_moderation_queue", "community.admin_moderate", "community.admin_resolve_appeal"];
const COMMUTER_FNS = ["community.record_jev_evidence", "community.add_post_photos", "community.submit_appeal"];
const APP_FNS_25 = [...CORRECTION_FNS, ...MODERATION_FNS, ...COMMUTER_FNS, "core.admin_review_media"];
const TRIGGER_FNS_25 = ["community.incorporate_corrections"];
const HELPERS_25 = ["community.assert_correction_reviewer", "community.assert_moderator", "community.content_target", "community.apply_content_outcome"];
const grantsOf = (sqlText: string, name: string) =>
  [...sqlText.matchAll(new RegExp(`grant execute on function ${esc(name)}\\([^)]*\\) to ([\\w, ]+);`, "g"))].map((m) => m[1]!.trim());

describe("0025: definer functions (N6)", () => {
  it("defines exactly these SECURITY DEFINER functions; the helpers are invoker-rights", () => {
    expect(fns25.filter((f) => /security definer/.test(f.header)).map((f) => f.name).sort()).toEqual([...APP_FNS_25, ...TRIGGER_FNS_25].sort());
    expect(fns25.filter((f) => !/security definer/.test(f.header)).map((f) => f.name).sort()).toEqual([...HELPERS_25].sort());
  });

  for (const name of [...APP_FNS_25, ...TRIGGER_FNS_25, ...HELPERS_25]) {
    it(`${name}: search_path pinned, owned by the definer, not executable by PUBLIC`, () => {
      expect(fn25(name).header).toMatch(/set search_path = pg_catalog,[\w, ]*pg_temp\s/);
      expect(SQL25).toMatch(new RegExp(`alter function ${esc(name)}\\([^)]*\\) owner to paranaga_definer;`));
      expect(SQL25).toMatch(new RegExp(`revoke execute on function ${esc(name)}\\([^)]*\\) from public;`));
    });
  }

  for (const name of APP_FNS_25) {
    it(`${name}: callable by paranaga_app only`, () => expect(grantsOf(SQL25, name)).toEqual(["paranaga_app"]));
  }
  for (const name of [...TRIGGER_FNS_25, ...HELPERS_25]) {
    it(`${name}: never granted to anyone`, () => expect(grantsOf(SQL25, name)).toEqual([]));
  }

  it("each staff function checks its role in the database first; commuter functions need a signed-in caller", () => {
    for (const name of CORRECTION_FNS) expect(fn25(name).body, name).toMatch(/v_user text := community\.assert_correction_reviewer\(\);/);
    for (const name of MODERATION_FNS) expect(fn25(name).body, name).toMatch(/v_user text := community\.assert_moderator\(\);/);
    for (const name of COMMUTER_FNS) expect(fn25(name).body, name).toContain("raise exception 'not authenticated' using errcode = '28000'");
    expect(fn25("community.assert_correction_reviewer").body).toContain("v_user is null or not (core.has_role('transport_reviewer') or core.has_role('admin'))");
    expect(fn25("community.assert_moderator").body).toContain("v_user is null or not (core.has_role('community_moderator') or core.has_role('admin'))");
    const media = fn25("core.admin_review_media").body;
    for (const s of [
      "m.purpose = 'correction_evidence'",
      "(core.has_role('transport_reviewer') or core.has_role('admin'))",
      "m.purpose = 'community_photo'",
      "(core.has_role('community_moderator') or core.has_role('admin'))",
      "c.author_id <> v_user",
      "ph.author_id <> v_user",
      "perform core.audit('media.review_view'",
    ]) {
      expect(media, s).toContain(s);
    }
  });

  it("nobody reviews or moderates their own content", () => {
    expect(fn25("community.admin_corrections").body).toContain("where c.author_id <> v_user");
    expect(fn25("community.admin_review_correction").body).toContain("if c.author_id = v_user then");
    expect(fn25("community.admin_moderate").body).toContain("if t.o_author = v_user then");
    const q = fn25("community.admin_moderation_queue").body;
    expect(q).toContain("v.author_id <> v_user");
    expect(q).toContain("c.author_id <> v_user");
    expect(q).toContain("ph.author_id <> v_user");
    expect(SQL25).toContain("constraint decision_not_own check (decided_by <> author_id)");
  });

  it("C9: accept writes into the open draft only (a draft version in no released revision, or a proposal), audits, and never touches transit rows", () => {
    const b = fn25("community.admin_review_correction").body;
    for (const s of ["v_draft := transit.admin_open_draft();", "m.revision_id = v_draft and m.version_id = p_draft_version_id", "transit.in_released_revision(p_draft_version_id)", "'kind', 'proposal'", "perform core.audit('correction.review'", "c.status is distinct from p_expected_status"]) {
      expect(b, s).toContain(s);
    }
    expect(b).not.toMatch(/(insert into|update) transit\./);
  });

  it("C9: only a published draft incorporates its accepted draft changes (the trigger on transit.revision)", () => {
    const b = fn25("community.incorporate_corrections").body;
    expect(b).toContain("new.status = 'published' and old.status is distinct from 'published'");
    expect(b).toContain("c.status = 'accepted' and c.draft_revision_id = new.id and c.draft_change ->> 'kind' = 'draft_version'");
    expect(SQL25).toMatch(/create trigger revision_incorporates_corrections\s+after update of status on transit\.revision\s+for each row execute function community\.incorporate_corrections\(\);/);
  });

  it("C10: overrides of Jev need a note (table and function) and are audited as overrides", () => {
    expect(SQL25).toContain("constraint decision_override_note check (not is_override or btrim(coalesce(note, '')) <> '')");
    const b = fn25("community.admin_moderate").body;
    expect(b).toContain("v_override := (j.recommendation = 'publish' and p_outcome = 'rejected') or (j.recommendation = 'reject' and p_outcome = 'published');");
    expect(b).toContain("if v_override and v_note is null then");
    expect(b).toContain("case when coalesce(v_override, false) then 'community.override' else 'community.moderate' end");
    expect(fn25("community.admin_resolve_appeal").body).toContain("v_override := p_outcome = 'overturned' and d.decided_by = 'policy';");
  });

  it("C10: an appeal goes to a different moderator (CHECK constraint, function and queue), once per item", () => {
    expect(SQL25).toContain("constraint appeal_other_moderator check (resolved_by is null or (resolved_by <> original_decider and resolved_by <> author_id))");
    expect(SQL25).toContain("create unique index appeal_target_uq on community.appeal (target_type, target_id);");
    expect(SQL25).toMatch(/decision_id\s+uuid not null unique references community\.moderation_decision \(id\)/);
    expect(fn25("community.admin_resolve_appeal").body).toContain("if a.original_decider = v_user then");
    expect(fn25("community.admin_moderation_queue").body).toContain("a.original_decider <> v_user and a.author_id <> v_user");
    expect(fn25("community.submit_appeal").body).toContain("t.o_author is distinct from v_user");
  });

  it("C10: a photo becomes public only through a moderator's approval, which records the public copy", () => {
    expect(SQL25).toContain("constraint post_photo_public check ((moderation_status = 'published') = (public_bucket is not null and public_key is not null))");
    expect(fns25.filter((f) => /public_bucket = p_public_bucket/.test(f.body)).map((f) => f.name)).toEqual(["community.apply_content_outcome"]);
    expect(fn25("community.add_post_photos").body).toContain("m.owner_id = v_user and m.purpose = 'community_photo' and m.status = 'verified'");
    expect(SQL25).toContain("create policy definer_insert on community.post_photo for insert to paranaga_definer with check (moderation_status = 'pending');");
  });

  it("the new tables have RLS enabled and forced; Jev evidence and decisions have no app grant", () => {
    for (const t of ["community.jev_evidence", "community.moderation_decision", "community.appeal", "community.post_photo"]) {
      expect(SQL25, t).toContain(`alter table ${t} enable row level security;`);
      expect(SQL25, t).toContain(`alter table ${t} force row level security;`);
    }
    for (const t of ["community.jev_evidence", "community.moderation_decision"]) {
      expect(SQL25).not.toMatch(new RegExp(`grant [^;]*on [^;]*${esc(t)}\\b[^;]*to [^;]*paranaga_app`));
    }
    expect(SQL25).toContain("create policy appeal_own_read on community.appeal for select to paranaga_app\n  using (author_id = (select core.current_user_id()));");
  });

  it("gives schema CREATE to the definer only for the length of the migration; no delete or truncate", () => {
    expect(SQL25.trimStart().startsWith("grant create on schema community to paranaga_definer;\ngrant create on schema core to paranaga_definer;")).toBe(true);
    expect(SQL25.trimEnd().endsWith("revoke create on schema core from paranaga_definer;\nrevoke create on schema community from paranaga_definer;")).toBe(true);
    expect(SQL25).not.toMatch(/grant [^;]*(delete|truncate)[^;]*to paranaga_definer/);
  });
});

describe("0025: the definer can reach every table its functions touch", () => {
  const all = fns25.map((f) => tables24(f.body));
  const reads = new Set(all.flatMap((x) => [...x.read]));
  const inserts = new Set(all.flatMap((x) => [...x.insert]));
  const updates = new Set(all.flatMap((x) => [...x.update]));

  it("finds the tables (guards against a regex that matches nothing)", () => {
    for (const t of ["community.correction", "community.jev_evidence", "community.appeal", "core.media_object", "transit.fare_rule_version", "transit.evidence_link"]) expect(reads.has(t), t).toBe(true);
    for (const t of ["community.correction_event", "community.moderation_decision", "community.appeal", "community.post_photo", "community.jev_evidence"]) expect(inserts.has(t), t).toBe(true);
    expect([...updates].sort()).toEqual(["community.appeal", "community.comment", "community.correction", "community.moderation_decision", "community.post", "community.post_photo", "community.post_version"]);
  });
  for (const t of reads) {
    it(`${t}: select grant and policy for paranaga_definer`, () => {
      expect(grantFor("select", t), "grant").toBe(true);
      expect(policyFor("select", t), "policy").toBe(true);
    });
  }
  for (const t of inserts) {
    it(`${t}: insert grant and policy for paranaga_definer`, () => {
      expect(grantFor("insert", t), "grant").toBe(true);
      expect(policyFor("insert", t), "policy").toBe(true);
    });
  }
  for (const t of updates) {
    it(`${t}: update grant and policy for paranaga_definer`, () => {
      expect(grantFor("update", t), "grant").toBe(true);
      expect(policyFor("update", t), "policy").toBe(true);
    });
  }
});

// ================================================================ 0026 (N7): complaint review, retention, roles, audit

const SQL26 = strip(readFileSync(path.join(DIR, "0026_complaint_review_system.sql"), "utf8"));
const fns26 = [...SQL26.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/g)].map((m) => ({
  name: m[1]!,
  header: m[3]!,
  body: m[4]!,
}));
const fn26 = (name: string) => fns26.find((f) => f.name === name)!;
const REVIEWER_FNS = ["priv.review_list", "priv.review_complaint", "priv.reviewer_evidence_download", "priv.set_complaint_legal_hold"];
const RETENTION_FNS = ["priv.retention_due", "priv.retention_purge_complaint", "priv.retention_purge_upload", "priv.retention_record_run"];
const ROLE_FNS = ["core.admin_find_user", "core.admin_staff", "core.grant_role", "core.revoke_role"];
const APP_FNS_26 = [...REVIEWER_FNS, ...RETENTION_FNS, ...ROLE_FNS];
const HELPERS_26 = ["priv.assert_complaint_reviewer", "priv.complaint_purgeable", "priv.upload_purgeable", "priv.assert_system", "core.assert_admin", "core.user_roles_json"];

describe("0026: definer functions (N7)", () => {
  it("defines exactly these SECURITY DEFINER functions; the helpers are invoker-rights", () => {
    expect(fns26.filter((f) => /security definer/.test(f.header)).map((f) => f.name).sort()).toEqual([...APP_FNS_26].sort());
    expect(fns26.filter((f) => !/security definer/.test(f.header)).map((f) => f.name).sort()).toEqual([...HELPERS_26].sort());
  });

  for (const name of [...APP_FNS_26, ...HELPERS_26]) {
    it(`${name}: search_path pinned, owned by the definer, not executable by PUBLIC`, () => {
      expect(fn26(name).header).toMatch(/set search_path = pg_catalog,[\w, ]*pg_temp\s/);
      expect(SQL26).toMatch(new RegExp(`alter function ${esc(name)}\\([^)]*\\) owner to paranaga_definer;`));
      expect(SQL26).toMatch(new RegExp(`revoke execute on function ${esc(name)}\\([^)]*\\) from public;`));
    });
  }
  for (const name of APP_FNS_26) it(`${name}: callable by paranaga_app only`, () => expect(grantsOf(SQL26, name)).toEqual(["paranaga_app"]));
  for (const name of HELPERS_26) it(`${name}: never granted to anyone`, () => expect(grantsOf(SQL26, name)).toEqual([]));

  it("C11: the complaint_reviewer role only (admins are not let in), checked before the step-up, first in every reviewer function", () => {
    const h = fn26("priv.assert_complaint_reviewer").body;
    expect(h).toContain("if v_user is null or not core.has_role('complaint_reviewer') then");
    expect(h.indexOf("core.has_role('complaint_reviewer')")).toBeLessThan(h.indexOf("perform priv.require_step_up();"));
    for (const name of REVIEWER_FNS) {
      expect(fn26(name).body, name).toMatch(/^\s*declare\s+v_user(?:_id)? text := priv\.assert_complaint_reviewer\(\);/);
    }
    for (const f of fns26.filter((x) => x.name.startsWith("priv."))) {
      expect(f.body, f.name).not.toMatch(/has_role\('(admin|community_moderator|transport_reviewer)'\)/);
    }
  });

  it("C11: never the reviewer's own report; never the reporter's id, an accessor id or a storage key in what the reviewer reads", () => {
    expect(fn26("priv.review_list").body).toContain("where c.reporter_id <> v_user");
    expect(fn26("priv.review_complaint").body).toContain("if not found or v_c.reporter_id = v_user then\n    return null;");
    expect(fn26("priv.reviewer_evidence_download").body).toContain("if v_reporter = v_user_id then");
    expect(fn26("priv.set_complaint_legal_hold").body).toContain("if not found or v_c.reporter_id = v_user then");
    for (const name of ["priv.review_list", "priv.review_complaint"]) {
      expect(fn26(name).body, name).not.toMatch(/'(reporterId|reporter_id|objectKey|object_key|originalKey|redactedKey|accessorId|actorId)'/);
    }
    // The list carries no text and no evidence; only the opened (audited) report does.
    expect(fn26("priv.review_list").body).not.toContain("description");
    expect(fn26("priv.review_complaint").body).toContain("'description', v_c.description");
  });

  it("C11: every read and change is audited; evidence issuance is also in priv.evidence_access with a 60-second expiry", () => {
    expect(fn26("priv.review_list").body).toContain("perform core.audit('complaint.queue.read'");
    expect(fn26("priv.review_complaint").body).toContain("perform core.audit('complaint.review.open', 'complaint', p_id::text, null);");
    expect(fn26("priv.review_complaint").body).toContain("perform core.audit('complaint.review.alert'");
    const ev = fn26("priv.reviewer_evidence_download").body;
    expect(ev).toContain("now() + interval '60 seconds'");
    expect(ev).toContain("perform core.audit('complaint.evidence.read'");
    expect(ev.indexOf("insert into priv.evidence_access")).toBeLessThan(ev.indexOf("return query"));
    expect(ev).toContain("m.status = 'verified' and m.bucket = 'evidence-private'");
    expect(fn26("priv.set_complaint_legal_hold").body).toContain("perform core.audit('complaint.legal_hold', 'complaint', p_id::text, jsonb_build_object('hold', p_hold));");
  });

  it("retention: system callers only, legal hold respected, re-checked under a row lock, rows and media together, audited as system", () => {
    for (const name of RETENTION_FNS) expect(fn26(name).body, name).toContain("perform priv.assert_system();");
    expect(fn26("priv.assert_system").body).toContain("if core.current_user_id() is not null then");
    const due = fn26("priv.complaint_purgeable").body;
    for (const s of ["c.legal_hold = false", "c.status in ('closed', 'withdrawn')", "coalesce(c.retention_until, coalesce(c.closed_at, c.updated_at) + interval '365 days') <= now()"]) expect(due, s).toContain(s);
    expect(fn26("priv.retention_due").body).toContain("c0.legal_hold = false");
    const purge = fn26("priv.retention_purge_complaint").body;
    const order = ["for update", "priv.complaint_purgeable(p_id)", "delete from priv.evidence_access", "delete from priv.external_handoff", "delete from priv.complaint_event", "delete from priv.complaint_media", "delete from priv.complaint c", "delete from core.media_object", "'system', 'retention.purge'"];
    const at = order.map((s) => purge.indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(fn26("priv.upload_purgeable").body).toContain("m.created_at < now() - interval '30 days'");
    expect(fn26("priv.retention_record_run").body).toContain("'system', 'retention.run'");
  });

  it("retention: deletes granted on exactly the purged tables, each narrowed by a policy to purgeable rows of a system caller", () => {
    const deletes = [...SQL26.matchAll(/grant delete on ([^;]+) to paranaga_definer;/g)].flatMap((m) => m[1]!.split(",").map((t) => t.trim())).sort();
    expect(deletes).toEqual(["core.media_object", "priv.complaint", "priv.complaint_event", "priv.complaint_media", "priv.evidence_access", "priv.external_handoff"]);
    expect(SQL26).toMatch(/create policy complaint_definer_purge on priv\.complaint as restrictive for delete to paranaga_definer\s+using \(core\.current_user_id\(\) is null and priv\.complaint_purgeable\(id\)\);/);
    for (const t of ["complaint_media", "complaint_event", "evidence_access", "external_handoff"]) {
      expect(SQL26, t).toMatch(new RegExp(`create policy \\w+ on priv\\.${t} as restrictive for delete to paranaga_definer\\s+using \\(core\\.current_user_id\\(\\) is null and priv\\.complaint_purgeable\\(complaint_id\\)\\);`));
    }
    expect(SQL26).toMatch(/create policy media_definer_purge on core\.media_object for delete to paranaga_definer\s+using \(core\.current_user_id\(\) is null and purpose = 'complaint_evidence'/);
    expect(SQL26).not.toMatch(/grant [^;]*\btruncate\b[^;]*to paranaga_definer/);
    const before = ALL.filter((m) => m.file < "0026").map((m) => m.sql).join("\n");
    expect(before).not.toMatch(/grant [^;]*\bdelete\b[^;]*on (?:priv\.\w+|core\.media_object)[^;]*to paranaga_definer/);
  });

  it("C12: role changes need admin, then a fresh step-up, a reason; never your own roles; never the last admin; audited with the reason", () => {
    const g = fn26("core.grant_role").body;
    const r = fn26("core.revoke_role").body;
    for (const b of [g, r]) {
      expect(b.indexOf("core.has_role('admin')")).toBeLessThan(b.indexOf("perform priv.require_step_up();"));
      expect(b.indexOf("core.has_role('admin')")).toBeGreaterThan(-1);
      expect(b).toContain("char_length(v_reason) < 3 or char_length(v_reason) > 500");
      expect(b).toContain("perform pg_advisory_xact_lock(hashtext('core.user_role'));");
      expect(b).toContain("'reason', left(v_reason, 200)");
    }
    expect(g).toContain("if p_user = v_actor then\n    raise exception 'admins cannot grant roles to themselves'");
    expect(g).toContain("p_role = 'commuter' or not exists (select 1 from core.role where code = p_role)");
    expect(g).toContain("not exists (select 1 from core.profile p where p.user_id = p_user)");
    expect(r).toContain("if p_user = v_actor then\n    raise exception 'admins cannot change their own roles'");
    expect(r).toContain("raise exception 'cannot remove the last admin' using errcode = '55000';");
    expect(r.indexOf("cannot remove the last admin")).toBeLessThan(r.indexOf("update core.user_role"));
  });

  it("C12: lookup by full email only, through four columns of neon_auth.user, granted only where it exists", () => {
    const f = fn26("core.admin_find_user").body;
    expect(f).toMatch(/^\s*declare\s+v_actor text := core\.assert_admin\(\);/);
    expect(f).toContain("where lower(u.email) = v_email");
    expect(f).not.toMatch(/\blike\b|ilike|similar to/);
    expect(f).toContain("perform core.audit('user.lookup', 'user', v_id, jsonb_build_object('found', v_id is not null));");
    expect(fn26("core.admin_staff").body).toMatch(/^\s*declare\s+v_actor text := core\.assert_admin\(\);/);
    expect(SQL26).toContain(`execute 'grant select (id, name, email, "emailVerified") on neon_auth."user" to paranaga_definer';`);
    expect(SQL26).not.toMatch(/neon_auth\.\w*session|grant [^;]*on neon_auth[^;]*to paranaga_app/);
  });

  it("audit log: staff read their own rows only; still append-only (no update or delete for anyone)", () => {
    expect(SQL26).toMatch(/create policy audit_read_own_staff on core\.audit_event for select to paranaga_app\s+using \(actor_user_id = \(select core\.current_user_id\(\)\)/);
    expect(SQL26).not.toMatch(/grant [^;]*\b(update|delete)\b[^;]*on core\.audit_event/);
    expect(SQL26).not.toMatch(/create policy \w+ on core\.audit_event for (update|delete|all)/);
  });

  it("gives schema CREATE to the definer only for the length of the migration", () => {
    expect(SQL26.trimStart().startsWith("grant create on schema priv to paranaga_definer;\ngrant create on schema core to paranaga_definer;")).toBe(true);
    expect(SQL26.trimEnd().endsWith("revoke create on schema core from paranaga_definer;\nrevoke create on schema priv from paranaga_definer;")).toBe(true);
  });
});

describe("0026: the definer can reach every table its functions touch", () => {
  const all = fns26.map((f) => tables24(f.body));
  const deletes = new Set(fns26.flatMap((f) => [...f.body.matchAll(/\bdelete from\s+((?:core|priv)\.[a-z_]+)\b/gi)].map((m) => m[1]!.toLowerCase())));
  const reads = new Set(all.flatMap((x) => [...x.read]));
  const inserts = new Set(all.flatMap((x) => [...x.insert]));
  const updates = new Set(all.flatMap((x) => [...x.update]));

  it("finds the tables (guards against a regex that matches nothing)", () => {
    for (const t of ["priv.complaint", "priv.complaint_media", "priv.evidence_access", "core.audit_event", "core.user_role", "core.profile", "core.media_object"]) expect(reads.has(t), t).toBe(true);
    expect([...deletes].sort()).toEqual(["core.media_object", "priv.complaint", "priv.complaint_event", "priv.complaint_media", "priv.evidence_access", "priv.external_handoff"]);
  });
  for (const t of reads) {
    it(`${t}: select grant and policy for paranaga_definer`, () => {
      expect(grantFor("select", t), "grant").toBe(true);
      expect(policyFor("select", t), "policy").toBe(true);
    });
  }
  for (const t of inserts) {
    it(`${t}: insert grant and policy for paranaga_definer`, () => {
      expect(grantFor("insert", t), "grant").toBe(true);
      expect(policyFor("insert", t), "policy").toBe(true);
    });
  }
  for (const t of updates) {
    it(`${t}: update grant and policy for paranaga_definer`, () => {
      expect(grantFor("update", t), "grant").toBe(true);
      expect(policyFor("update", t), "policy").toBe(true);
    });
  }
  for (const t of deletes) {
    it(`${t}: delete grant and policy for paranaga_definer`, () => {
      expect(grantFor("delete", t), "grant").toBe(true);
      expect(policyFor("delete", t), "policy").toBe(true);
    });
  }
});
