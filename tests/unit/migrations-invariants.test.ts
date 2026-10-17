// Increment B migrations (0013 onward), read as text (task B10). No database is needed: these pin
// the patterns every migration must keep. The live checks are scripts/check-rls.ts and the
// tests/integration/*-rls.test.ts suites, which run in CI against a migrated Neon branch.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve("db/migrations");
const FILES = readdirSync(DIR)
  .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
  .sort();
const INCREMENT_B = FILES.filter((f) => Number(f.slice(0, 4)) >= 13);
// Statements only: line comments removed so prose never satisfies or breaks a rule.
const sqlOf = (file: string) =>
  readFileSync(path.join(DIR, file), "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");

/** Every `create [or replace] function name(args) … $$ … $$;` with its header. */
function functions(sql: string) {
  return [...sql.matchAll(/create (?:or replace )?function ([\w.]+)\(([\s\S]*?)\$\$[\s\S]*?\$\$;/g)].map((m) => ({
    name: m[1]!,
    text: m[0],
  }));
}

describe("increment B migrations: tables", () => {
  for (const file of INCREMENT_B) {
    const sql = sqlOf(file);
    const tables = [...sql.matchAll(/create table ([\w.]+)/g)].map((m) => m[1]!);
    for (const t of tables) {
      it(`${file}: ${t} enables and forces row level security`, () => {
        const esc = t.replace(".", "\\.");
        expect(sql).toMatch(new RegExp(`alter table ${esc}\\s+enable row level security;`));
        expect(sql).toMatch(new RegExp(`alter table ${esc}\\s+force row level security;`));
      });
    }
  }
});

describe("increment B migrations: security definer functions", () => {
  for (const file of INCREMENT_B) {
    const sql = sqlOf(file);
    for (const fn of functions(sql).filter((f) => /security definer/.test(f.text))) {
      it(`${file}: ${fn.name} pins search_path (pg_temp last), is owned by paranaga_definer and revoked from public`, () => {
        expect(fn.text).toMatch(/set search_path = [\w, ]*pg_temp\s/);
        expect(sql).toMatch(new RegExp(`alter function ${fn.name.replace(".", "\\.")}\\([^)]*\\) owner to paranaga_definer;`));
        expect(sql).toMatch(new RegExp(`revoke execute on function ${fn.name.replace(".", "\\.")}\\([^)]*\\) from public;`));
      });
    }
  }
});

describe("increment B migrations: schema CREATE is never left granted to paranaga_definer", () => {
  const state = new Map<string, { granted: boolean; file: string }>();
  for (const file of FILES) {
    const sql = sqlOf(file);
    for (const m of sql.matchAll(/(grant|revoke) create on schema (\w+) (?:to|from) paranaga_definer;/g)) {
      state.set(m[2]!, { granted: m[1] === "grant", file });
    }
  }
  it("every grant create on schema … to paranaga_definer is revoked by the end of the migrations", () => {
    const open = [...state.entries()].filter(([, s]) => s.granted).map(([schema, s]) => `${schema} (${s.file})`);
    expect(open).toEqual([]);
  });

  for (const file of INCREMENT_B) {
    const sql = sqlOf(file);
    const grants = [...sql.matchAll(/grant create on schema (\w+) to paranaga_definer;/g)].map((m) => m[1]!);
    const revokes = [...sql.matchAll(/revoke create on schema (\w+) from paranaga_definer;/g)].map((m) => m[1]!);
    // 0016 and 0017 are the known exception, closed by 0020 (they are unchanged to keep checksums).
    if (file.startsWith("0016_") || file.startsWith("0017_")) continue;
    it(`${file}: revokes every schema CREATE it grants`, () => {
      expect([...new Set(revokes)].sort()).toEqual([...new Set(grants)].sort());
    });
  }
});

describe("0020: moderators never resolve reports on their own content", () => {
  const sql = sqlOf(FILES.find((f) => f.startsWith("0020_"))!);
  const fn = (name: string) => functions(sql).find((f) => f.name === name)!.text;

  it("report_queue hides reports whose target the caller authored", () => {
    const body = fn("community.report_queue");
    expect(body).toMatch(/p\.author_id = core\.current_user_id\(\)/);
    expect(body).toMatch(/c\.author_id = core\.current_user_id\(\)/);
    expect(body).toMatch(/has_role\('community_moderator'\)/);
  });

  it("resolve_report refuses the author of the reported content", () => {
    const body = fn("community.resolve_report");
    expect(body).toMatch(/if v_author = v_actor then\s+raise exception 'forbidden: own content' using errcode = '42501'/);
  });

  it("keeps the grants: execute for paranaga_app only", () => {
    for (const sig of ["community.report_queue\\(integer\\)", "community.resolve_report\\(uuid, text\\)"]) {
      expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to paranaga_app;`));
    }
  });
});
