// db/migrations/0029_intercity_ic1.sql read as text (IC1 Task 1). Pins the intercity schema without
// a database: the source family, every new CHECK, forced row level security on the new tables, the
// running guard, and that publish_revision (0010) and admin_validation_facts (0024) were copied
// line for line before the new checks were added. The live checks are scripts/check-rls.ts and
// tests/integration/intercity-schema.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve("db/migrations");
const raw = (file: string) => readFileSync(path.join(DIR, file), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const RAW = raw("0029_intercity_ic1.sql");
const SQL = strip(RAW);
const esc = (s: string) => s.replace(/\./g, "\\.");

/** The raw text of `create or replace function name(...) ... $$ ... $$;` in a migration. */
const fnText = (text: string, name: string) => {
  const m = new RegExp(`create or replace function ${esc(name)}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`).exec(text);
  if (!m) throw new Error(`no ${name}`);
  return m[0];
};
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
/** Index of the first line of `sub` not found, in order, inside `whole` (-1 when all are). */
const firstMissing = (sub: string[], whole: string[]) => {
  let j = 0;
  for (const [i, line] of sub.entries()) {
    while (j < whole.length && whole[j] !== line) j++;
    if (j === whole.length) return i;
    j++;
  }
  return -1;
};
const comments = (text: string) => lines(text).filter((l) => l.startsWith("--"));
const raises = (text: string) => [...strip(text).matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]!);
const kindList = (s: string) => {
  const m = /add constraint revision_member_entity_kind_check check \(entity_kind in \(([\s\S]*?)\)\);/.exec(s);
  return [...(m?.[1] ?? "").matchAll(/'(\w+)'/g)].map((x) => x[1]!);
};

describe("0029: ingest.source", () => {
  it("keeps the 0010 code families and adds IC01…", () => {
    const check = /alter table ingest\.source add constraint source_code_check check \(([\s\S]*?)\);/.exec(SQL)?.[1] ?? "";
    for (const p of ["'^S[0-9]{2,3}$'", "'^OSM-[0-9]{4}-[0-9]{2}-[0-9]{2}$'", "'^N[0-9]{2}$'", "'^U[0-9]{2}$'",
      "'^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$'", "'^R[TLPH][0-9]{2}$'", "'^IC[0-9]{2}$'"]) {
      expect(check, p).toContain(`code ~ ${p}`);
    }
  });
});

describe("0029: CHECKs", () => {
  for (const name of ["rsv_osm_or_no_distance", "rsv_dates_required", "rsv_review_after_as_of", "rsv_status_since",
    "rsv_not_running_no_fare", "rsv_rail_air_no_rules", "rsv_status_note_code", "rsv_access_note_code",
    "fo_regional_basis", "fo_regional_month", "fo_high"]) {
    it(`adds ${name}`, () => {
      expect(SQL).toMatch(new RegExp(`add constraint ${name}\\s+check`));
    });
  }

  it("service status note codes never include planned_not_funded (AC-IC3)", () => {
    const c = /add constraint rsv_status_note_code check \(([^;]*)\);/.exec(SQL)?.[1] ?? "";
    expect(c).toContain("'bridge_damage_no_reopening_date'");
    expect(c).not.toContain("planned_not_funded");
  });

  it("drops the community_mapped-only status and the non-empty OSM relation rule", () => {
    expect(SQL).toContain("drop constraint regional_service_version_status_check");
    expect(SQL).toContain("drop constraint regional_service_version_osm_relation_ids_check");
    expect(SQL).toContain("'unconfirmed'");
  });
});

describe("0029: new tables", () => {
  for (const t of ["transit.regional_destination", "transit.regional_destination_version", "transit.regional_departure"]) {
    it(`${t}: forced row level security and the four policies`, () => {
      const e = esc(t);
      expect(SQL).toMatch(new RegExp(`create table ${e} \\(`));
      expect(SQL).toMatch(new RegExp(`alter table ${e} enable row level security;`));
      expect(SQL).toMatch(new RegExp(`alter table ${e} force row level security;`));
      for (const p of ["public_read", "import_read", "import_insert", "definer_read"]) {
        expect(SQL).toMatch(new RegExp(`create policy ${p} on ${e}\\s`));
      }
    });
  }
  it("grants: no write for the app or the definer", () => {
    expect(SQL).not.toMatch(/grant [^;]*\b(insert|update|delete)\b[^;]*to [^;]*(paranaga_app|paranaga_definer)/);
  });
});

describe("0029: running guard", () => {
  const f = fnText(SQL, "transit.regional_child_running_guard");
  it("invoker rights, pinned search_path, 23514", () => {
    expect(f).not.toContain("security definer");
    expect(f).toContain("set search_path = pg_catalog, transit, pg_temp");
    expect(f).toContain("'suspended or discontinued services carry no fares or departures' using errcode = '23514'");
    expect(SQL).toContain("revoke execute on function transit.regional_child_running_guard() from public;");
  });
  it("fires before insert on departures and on regional fare observations", () => {
    expect(SQL).toMatch(/before insert on transit\.regional_departure\s+for each row execute function transit\.regional_child_running_guard\(\);/);
    expect(SQL).toMatch(/before insert on transit\.fare_observation\s+for each row when \(new\.regional_service_version_id is not null\)\s+execute function transit\.regional_child_running_guard\(\);/);
  });
});

describe("0029: membership", () => {
  it("is the 0010 list plus regional_destination", () => {
    const before = kindList(strip(raw("0010_route_notes_graph_v2.sql")));
    expect(before.length).toBeGreaterThan(20);
    expect(kindList(SQL)).toEqual([...before, "regional_destination"]);
  });
});

describe("0029: publish_revision", () => {
  const before = fnText(raw("0010_route_notes_graph_v2.sql"), "transit.publish_revision");
  const after = fnText(RAW, "transit.publish_revision");
  it("contains the 0010 function line for line, in order", () => {
    expect(firstMissing(lines(before), lines(after))).toBe(-1);
  });
  it("keeps the check comments and messages in their order and appends the new checks", () => {
    expect(comments(after).filter((c) => !c.startsWith("-- 0029"))).toEqual(comments(before));
    const old = raises(before);
    const msgs = raises(after);
    expect(msgs.slice(0, old.length)).toEqual(old);
    expect(msgs.slice(old.length)).toEqual([
      "revision % has regional services with an unknown destination code: %",
      "revision % has suspended or discontinued services with fares or departures: %",
    ]);
  });
  it("checks regional_destination members for synthetic or missing rows", () => {
    expect(after).toMatch(/when 'regional_destination' then \(\s+select d\.is_synthetic or dv\.is_synthetic/);
  });
  it("stays owned by the definer and not executable by PUBLIC", () => {
    expect(SQL).toContain("alter function transit.publish_revision(uuid) owner to paranaga_definer;");
    expect(SQL).toContain("revoke execute on function transit.publish_revision(uuid) from public;");
  });
});

describe("0029: admin_validation_facts", () => {
  const before = fnText(raw("0024_admin_stops_imports.sql"), "transit.admin_validation_facts");
  const after = fnText(RAW, "transit.admin_validation_facts");
  it("contains the 0024 function line for line, in order", () => {
    expect(firstMissing(lines(before), lines(after))).toBe(-1);
  });
  it("adds regional_destination to the members CASEs and the regional facts", () => {
    expect([...after.matchAll(/when 'regional_destination' then/g)]).toHaveLength(2);
    for (const k of ["'regionalServices'", "'regionalDestinations'", "'sourceEvidenceTypes'", "'departureCount'",
      "'observationCount'", "'observationsWithoutMonth'", "'serviceCount'"]) {
      expect(after, k).toContain(k);
    }
  });
  it("owner, grants and the schema CREATE bracket", () => {
    expect(SQL).toContain("alter function transit.admin_validation_facts(uuid) owner to paranaga_definer;");
    expect(SQL).toContain("revoke execute on function transit.admin_validation_facts(uuid) from public;");
    expect(SQL).toContain("grant execute on function transit.admin_validation_facts(uuid) to paranaga_app;");
    const grant = SQL.indexOf("grant create on schema transit to paranaga_definer;");
    expect(grant).toBeGreaterThan(-1);
    expect(grant).toBeLessThan(SQL.indexOf("create or replace function transit.publish_revision"));
    expect(SQL.indexOf("revoke create on schema transit from paranaga_definer;"))
      .toBeGreaterThan(SQL.indexOf("create or replace function transit.admin_validation_facts"));
  });
});

describe("0029: published views", () => {
  const views = ["transit.v_published_regional_services", "transit.v_published_regional_destinations",
    "transit.v_published_regional_departures", "transit.v_published_regional_observations", "transit.v_published_sources"];
  for (const v of views) {
    it(`${v}: security_invoker and readable by the app`, () => {
      expect(SQL).toMatch(new RegExp(`create (or replace )?view ${esc(v)} with \\(security_invoker = true\\) as`));
      expect(SQL).toMatch(new RegExp(`grant select on [^;]*${esc(v)}\\b[^;]*to paranaga_app;`));
    });
  }
  it("v_published_sources is the 0010 view plus the regional views and intercity notes", () => {
    const body = (s: string) => /create or replace view transit\.v_published_sources[\s\S]*?;/.exec(strip(s))![0];
    const before = lines(body(raw("0010_route_notes_graph_v2.sql")));
    const after = body(RAW);
    // The last 0010 line closes the union; everything before it is kept in order.
    expect(firstMissing(before.slice(0, -1), lines(after))).toBe(-1);
    for (const v of ["v_published_regional_destinations", "v_published_regional_departures", "v_published_regional_observations"]) {
      expect(after).toContain(`transit.${v} x`);
    }
    expect(after).toContain("starts_with(x.key, 'intercity_')");
  });
});
