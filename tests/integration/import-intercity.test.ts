// Reviewed intercity seed import (IC1 Task 4) against a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/import-intercity.test.ts
// The committed seed was approved by the owner on 2026-10-28 (reviewStatus "owner_approved"); the
// commit tests still build their own in-memory approved copy, and a draft copy proves the refusal.
// The open draft is made the way the admin console makes it (transit.admin_create_draft as a
// transport reviewer). The writer only ever writes into that draft and never publishes; the last
// test publishes it itself, re-imports the modes seed (carry-forward guard), and afterAll puts the
// previously published revision back and closes every draft this file left open.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";
import {
  buildImportPlan,
  readDataFiles,
  readNewestModesSeed,
  readNewestOsmSnapshot,
  readPinnedRoadsSnapshot,
  type ModesFile,
} from "../../scripts/lib/import-plan";
import { commitImport } from "../../scripts/lib/import-writer";
import {
  buildIntercityPlan,
  commitIntercity,
  dryRunIntercity,
  INTERCITY_DIR,
  readNewestIntercitySeed,
  type IntercityFile,
} from "../../scripts/lib/intercity-writer";
import { ImportRefusedError } from "../../scripts/lib/sql-rows";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

const TABLES = [
  "ingest.source", "ingest.source_document", "ingest.batch", "transit.revision", "transit.revision_member",
  "transit.terminal", "transit.terminal_version", "transit.regional_service", "transit.regional_service_version",
  "transit.regional_destination", "transit.regional_destination_version", "transit.regional_departure",
  "transit.fare_observation", "transit.dataset_note",
];

type SeedJson = {
  header: { reviewStatus: string; synthetic?: boolean };
  services: { code: string; status: string; observations: unknown[] }[];
};

describe.skipIf(!ownerUrl || !appUrl)("reviewed intercity seed import (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const reviewer = `test-ic-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;
  let previous: string | null = null;
  let draftId = "";
  const real = readNewestIntercitySeed()!;
  const realJson = () => JSON.parse(real.bytes.toString("utf8")) as SeedJson;
  // Compact JSON: the test copies never share the committed file's bytes (production already holds its batch).
  const fileOf = (json: unknown): IntercityFile => ({ fileName: real.fileName, bytes: Buffer.from(JSON.stringify(json)) });
  const draftSeed = (() => {
    const json = realJson();
    json.header.reviewStatus = "draft";
    return fileOf(json);
  })();
  const approved = (() => {
    const json = realJson();
    json.header.reviewStatus = "owner_approved";
    return fileOf(json);
  })();

  const asImport = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      return await fn(owner);
    } finally {
      await owner.query("rollback");
    }
  };
  const tableCounts = () =>
    asImport(async (c) => {
      const out: Record<string, number> = {};
      for (const t of TABLES) out[t] = Number((await c.query(`select count(*) as n from ${t}`)).rows[0].n);
      return out;
    });
  const pointer = async () => (await owner.query<{ id: string }>("select revision_id as id from transit.published_pointer")).rows[0]?.id ?? null;
  const publish = async (revisionId: string) => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      await owner.query("select transit.publish_revision($1)", [revisionId]);
      await owner.query("commit");
    } catch (error) {
      await owner.query("rollback");
      throw error;
    }
  };
  const closeDrafts = async () => {
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query("update transit.revision set status = 'superseded' where status in ('draft', 'validating')");
    await owner.query("commit");
  };
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected a failure");
  };
  /** The member version of a regional service in a revision. */
  const serviceIn = (revisionId: string, code: string) =>
    asImport(async (c) => (await c.query(
      `select v.id, v.status, v.name, v.operators::text[] as operators, v.fare_rule_codes::text[] as rules,
              v.destination_codes::text[] as destinations, v.as_of::text as as_of, v.distance_km::float8 as km,
              v.osm_relation_versions::int[] as versions
         from transit.revision_member m join transit.regional_service s on s.id = m.entity_id
         join transit.regional_service_version v on v.id = m.version_id
        where m.revision_id = $1 and m.entity_kind = 'regional_service' and s.code = $2`, [revisionId, code])).rows[0]);

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
    previous = await pointer();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [reviewer]);
    for (const role of ["commuter", "transport_reviewer"]) {
      await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [reviewer, role]);
    }
    await owner.query("commit");
    // One open draft at a time: drafts other files left on this throwaway branch are closed first.
    await closeDrafts();
  }, 60_000);

  afterAll(async () => {
    if (owner) {
      if (previous && (await pointer()) !== previous) await publish(previous);
      await closeDrafts();
    }
    await app?.end();
    await owner?.end();
  }, 60_000);

  it("the plan reads the committed (owner-approved) seed and lists every exclusion with its reason", () => {
    expect(real.fileName).toMatch(/^naga-intercity-seed-\d{4}-\d{2}-\d{2}\.json$/);
    expect(INTERCITY_DIR).toBe("data/source/research");
    const plan = buildIntercityPlan(real);
    expect(plan.problems).toEqual([]);
    expect(plan.commitProblems).toEqual([]);
    const draft = realJson();
    draft.header.reviewStatus = "draft";
    expect(buildIntercityPlan(fileOf(draft)).commitProblems).toEqual(["reviewStatus is draft, owner_approved required"]);
    expect(plan.excluded.length).toBeGreaterThan(0);
    for (const e of plan.excluded) expect(e).toMatch(/: \S/);
    expect(plan.counts).toMatchObject({ services: 18, service_links: 4, destinations: 31, terminals: 1, dataset_notes: 1 });
  });

  it("refuses to commit when there is no open draft", async () => {
    const before = await tableCounts();
    const error = await failure(commitIntercity(ownerUrl!, buildIntercityPlan(approved)));
    expect(error).toBeInstanceOf(ImportRefusedError);
    expect(error.message).toMatch(/no open draft/);
    expect(await tableCounts()).toEqual(before);
  });

  it("opens the draft the way the admin console does", async () => {
    draftId = await runInRequestContext(app, { userId: reviewer, requestId: `ic-${run}` }, async (db) =>
      String((await db.execute(sql`select transit.admin_create_draft() as id`)).rows[0]!.id));
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a dry run prints decisions and writes nothing", async () => {
    const before = await tableCounts();
    const result = await dryRunIntercity(ownerUrl!, buildIntercityPlan(draftSeed));
    expect(result.problems).toEqual([]);
    expect(result.draft?.id).toBe(draftId);
    expect(result.commitProblems).toEqual(["reviewStatus is draft, owner_approved required"]);
    expect(result.decisions.some((d) => /^service RS06 /.test(d))).toBe(true);
    expect(result.decisions.some((d) => /^destination D-LEGAZPI /.test(d))).toBe(true);
    expect(result.decisions.some((d) => /^terminal T17 /.test(d))).toBe(true);
    expect(result.decisions.some((d) => /^serviceLink RS01 /.test(d))).toBe(true);
    expect(await tableCounts()).toEqual(before);
  });

  it("a reviewStatus draft seed is refused and writes nothing", async () => {
    const before = await tableCounts();
    const error = await failure(commitIntercity(ownerUrl!, buildIntercityPlan(draftSeed)));
    expect(error).toBeInstanceOf(ImportRefusedError);
    expect(error.message).toMatch(/owner_approved required/);
    expect(await tableCounts()).toEqual(before);
  });

  it("a synthetic seed is refused and writes nothing", async () => {
    const json = realJson();
    json.header.reviewStatus = "owner_approved";
    json.header.synthetic = true;
    const before = await tableCounts();
    const error = await failure(commitIntercity(ownerUrl!, buildIntercityPlan(fileOf(json))));
    expect(error).toBeInstanceOf(ImportRefusedError);
    expect(error.message).toMatch(/synthetic/);
    expect(await tableCounts()).toEqual(before);
  });

  it("a suspended service with a fare aborts at dry run, and its commit writes nothing", async () => {
    const json = realJson();
    json.header.reviewStatus = "owner_approved";
    const rs09 = json.services.find((s) => s.code === "RS09")!;
    expect(rs09.status).toBe("suspended");
    rs09.observations.push({
      kind: "official_matrix", destination_code: null, category: "regular", seat_class_text: null,
      amount_centavos: 1500, amount_high_centavos: 15500, basis: "official", observed_month: "2025-06", source_codes: ["IC06"],
    });
    const plan = buildIntercityPlan(fileOf(json));
    const before = await tableCounts();
    const dry = await dryRunIntercity(ownerUrl!, plan);
    expect(dry.problems).toContain("service RS09: not running but has fare observations");
    const error = await failure(commitIntercity(ownerUrl!, plan));
    expect(error).toBeInstanceOf(ImportRefusedError);
    expect(error.message).toMatch(/not running but has fare observations/);
    expect(await tableCounts()).toEqual(before);
  });

  it("a commit writes into the open draft; the published pointer does not move", async () => {
    const published = await pointer();
    const result = await commitIntercity(ownerUrl!, buildIntercityPlan(approved));
    expect(result).toMatchObject({ outcome: "committed", draftId });
    // Production published this seed on 2026-10-28, so a branch of main already carries every member forward
    // (members_changed is 0 there); a fresh database changes them all. Either way the draft holds the seed.
    expect(result.counts.members_changed).toBeGreaterThanOrEqual(0);
    expect(result.counts.seed_members).toBeGreaterThan(0);
    expect(await pointer()).toBe(published);
    const status = await asImport(async (c) => (await c.query("select status from transit.revision where id = $1", [draftId])).rows[0]);
    expect(status).toEqual({ status: "draft" });

    const kinds = await asImport(async (c) => (await c.query<{ entity_kind: string; n: number }>(
      `select entity_kind, count(*)::int as n from transit.revision_member
        where revision_id = $1 and entity_kind in ('regional_destination', 'regional_service') group by 1 order by 1`, [draftId])).rows);
    expect(kinds).toEqual([{ entity_kind: "regional_destination", n: 31 }, { entity_kind: "regional_service", n: 24 }]);
    const t17 = await asImport(async (c) => (await c.query(
      `select tv.kind, tv.modes::text[] as modes, tv.geog is null as no_coord from transit.revision_member m
         join transit.terminal t on t.id = m.entity_id join transit.terminal_version tv on tv.id = m.version_id
        where m.revision_id = $1 and m.entity_kind = 'terminal' and t.code = 'T17'`, [draftId])).rows);
    expect(t17).toEqual([{ kind: "airport", modes: ["air"], no_coord: true }]);
    const note = await asImport(async (c) => (await c.query(
      `select n.value->>'status' as status from transit.revision_member m join transit.dataset_note n on n.id = m.entity_id
        where m.revision_id = $1 and m.entity_kind = 'dataset_note' and n.key = 'intercity_south_long_haul'`, [draftId])).rows);
    expect(note).toEqual([{ status: "planned_not_funded" }]);

    // Departures and observations hang off the new service version; a month is stored as its first day.
    const rs08 = (await serviceIn(draftId, "RS08"))!;
    const children = await asImport(async (c) => ({
      departures: (await c.query(
        `select pattern, trips_per_day, observed_on::text as on from transit.regional_departure where regional_service_version_id = $1`,
        [rs08.id])).rows,
      observations: (await c.query(
        `select category, amount_centavos, amount_high_centavos, basis, observed_at::text as at, mode_code
           from transit.fare_observation where regional_service_version_id = $1 order by category`, [rs08.id])).rows,
    }));
    expect(children.departures).toEqual([{ pattern: "daily_unspecified", trips_per_day: 3, on: "2025-11-05" }]);
    expect(children.observations).toEqual([
      { category: "regular", amount_centavos: 1500, amount_high_centavos: 7500, basis: "at_launch", at: "2025-11-01", mode_code: "rail" },
      { category: "senior_pwd", amount_centavos: 1200, amount_high_centavos: 6000, basis: "at_launch", at: "2025-11-01", mode_code: "rail" },
    ]);
    const rs24 = (await serviceIn(draftId, "RS24"))!;
    const rs24Departure = await asImport(async (c) => (await c.query(
      "select observed_on::text as on from transit.regional_departure where regional_service_version_id = $1", [rs24.id])).rows);
    expect(rs24Departure).toEqual([{ on: "2026-03-01" }]);

    // Legacy links: a new community_mapped version with destination codes; the distance is kept.
    const rs01 = (await serviceIn(draftId, "RS01"))!;
    expect(rs01).toMatchObject({ status: "community_mapped", destinations: ["D-GOA"] });
    const publishedRs01 = (await serviceIn(published!, "RS01"))!;
    expect(rs01.km).toBe(publishedRs01.km);
    expect(rs01.versions).toEqual(publishedRs01.versions);
    // RS04 and RS07 are untouched.
    expect((await serviceIn(draftId, "RS04"))!.id).toBe((await serviceIn(published!, "RS04"))!.id);
  }, 120_000);

  it("in the draft RS06 is discontinued_reported, without Bicol Isarog", async () => {
    const rs06 = (await serviceIn(draftId, "RS06"))!;
    expect(rs06).toMatchObject({ status: "discontinued_reported", operators: ["Philtranco"], rules: [], destinations: ["D-PITX"] });
    expect(JSON.stringify(rs06)).not.toMatch(/Bicol Isarog/);
    const children = await asImport(async (c) => (await c.query<{ n: number }>(
      `select (select count(*) from transit.regional_departure where regional_service_version_id = $1)
            + (select count(*) from transit.fare_observation where regional_service_version_id = $1) as n`, [rs06.id])).rows[0]);
    expect(Number(children!.n)).toBe(0);
  });

  it("a second commit of the same file is unchanged and writes zero rows", async () => {
    const before = await tableCounts();
    const result = await commitIntercity(ownerUrl!, buildIntercityPlan(approved));
    expect(result.outcome).toBe("unchanged");
    expect(await tableCounts()).toEqual(before);
  });

  it("re-importing the modes seed keeps RS06 v2 and the intercity links (modes and road stages)", async () => {
    const rs06 = (await serviceIn(draftId, "RS06"))!;
    const rs01 = (await serviceIn(draftId, "RS01"))!;
    const rs08 = (await serviceIn(draftId, "RS08"))!;
    // The test, not the writer, publishes the draft (an admin would, after review and step-up).
    await publish(draftId);
    expect(await pointer()).toBe(draftId);

    // The same modes seed with other bytes: a new batch of the same date, carried from the draft.
    const seed = readNewestModesSeed()!;
    const reformatted: ModesFile = { fileName: seed.fileName, bytes: Buffer.from(`${JSON.stringify(JSON.parse(seed.bytes.toString("utf8")), null, 3)}\n`) };
    const plan = buildImportPlan(readDataFiles("Data_Sets"), readNewestOsmSnapshot(), reformatted, readPinnedRoadsSnapshot());
    expect(plan.problems).toEqual([]);
    const result = await commitImport(ownerUrl!, plan);
    expect(result.modes).toMatchObject({ outcome: "committed" });
    expect(result.lines).toMatchObject({ outcome: "committed" });
    const head = (await pointer())!;
    expect(head).toBe(result.lines!.outcome === "committed" ? result.lines!.revisionId : "");
    expect((await serviceIn(head, "RS06"))!.id).toBe(rs06.id);
    expect((await serviceIn(head, "RS01"))!.id).toBe(rs01.id);
    expect((await serviceIn(head, "RS08"))!.id).toBe(rs08.id);
    const modesRevision = result.modes!.outcome === "committed" ? result.modes!.revisionId : "";
    expect((await serviceIn(modesRevision, "RS06"))!.id).toBe(rs06.id);
    const destinations = await runInRequestContext(app, { userId: null, requestId: `ic-${run}` }, async (db) =>
      (await db.execute(sql`select count(*)::int as n from transit.v_published_regional_destinations`)).rows);
    expect(destinations).toEqual([{ n: 31 }]);
  }, 600_000);
});

// Keeps the reader honest: the committed file is the owner-approved one (2026-10-28).
it("the committed intercity seed is reviewStatus owner_approved", () => {
  const json = JSON.parse(readFileSync(`${INTERCITY_DIR}/${readNewestIntercitySeed()!.fileName}`, "utf8")) as SeedJson;
  expect(json.header.reviewStatus).toBe("owner_approved");
});
