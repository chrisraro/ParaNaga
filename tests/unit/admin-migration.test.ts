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
