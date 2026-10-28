import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPIRY_DAYS,
  commitProblems,
  excludedIntercity,
  importableIntercity,
  parseIntercitySeed,
  reviewByFor,
  validateIntercitySeed,
} from "@/domain/import/intercity-seed";

const json: unknown = JSON.parse(readFileSync("tests/fixtures/intercity/intercity-seed-synthetic.json", "utf8"));
const ctx = { terminalCodes: ["T01", "T06"], fareRuleCodes: ["F06"] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const clone = (): Json => JSON.parse(JSON.stringify(json));
const svc = (j: Json, code: string) => j.services.find((s: Json) => s.code === code);
const problems = (j: Json) => validateIntercitySeed(parseIntercitySeed(j), ctx);

describe("parseIntercitySeed", () => {
  it("accepts the synthetic fixture and validates it clean", () => {
    expect(problems(clone())).toEqual([]);
  });

  it("is strict: unknown keys are refused", () => {
    const j = clone();
    j.services[0].ai_confidence = "high";
    expect(() => parseIntercitySeed(j)).toThrow(/services\.0/);
  });

  it("a missing reviewer or decision is an error", () => {
    const a = clone();
    delete a.services[0].review.reviewer;
    expect(() => parseIntercitySeed(a)).toThrow(/review\.reviewer/);
    const b = clone();
    delete b.destinations[0].review.decision;
    expect(() => parseIntercitySeed(b)).toThrow(/review\.decision/);
  });

  it("refuses planned_not_funded as a status note code", () => {
    const j = clone();
    svc(j, "RS90").status_note_code = "planned_not_funded";
    expect(() => parseIntercitySeed(j)).toThrow(/status_note_code/);
  });
});

describe("reviewByFor / EXPIRY_DAYS", () => {
  it("adds the window for every basis", () => {
    expect(EXPIRY_DAYS).toEqual({
      official: 365, terminal_rule: 365, news: 180, booking_site: 120,
      at_launch: 180, travel_guide: 0, undated: 0, suspended: 30,
    });
    expect(reviewByFor("booking_site", "2026-10-28")).toBe("2027-02-25");
    expect(reviewByFor("news", "2026-10-28")).toBe("2027-04-26");
    expect(reviewByFor("at_launch", "2026-10-28")).toBe("2027-04-26");
    expect(reviewByFor("official", "2026-10-28")).toBe("2027-10-28");
    expect(reviewByFor("terminal_rule", "2026-10-28")).toBe("2027-10-28");
    expect(reviewByFor("suspended", "2026-10-28")).toBe("2026-11-27");
    expect(reviewByFor("travel_guide", "2026-10-28")).toBe("2026-10-28");
    expect(reviewByFor("undated", "2026-10-28")).toBe("2026-10-28");
  });
});

describe("validateIntercitySeed", () => {
  it("a suspended service with a fare, an observation or a departure is an error", () => {
    const j = clone();
    const s = svc(j, "RS91");
    s.fare_rule_codes = ["F06"];
    s.observations = [svc(j, "RS90").observations[0]];
    s.departures = [svc(j, "RS90").departures[0]];
    const p = problems(j);
    expect(p.filter((x) => x.startsWith("service RS91") && /not running/.test(x))).toHaveLength(3);
  });

  it("an operating service with only booking-site sources is an error", () => {
    const j = clone();
    const s = svc(j, "RS92");
    s.status = "operating";
    expect(problems(j)).toContain("service RS92: operating needs an official or news source");
  });

  it("a review_by later than the basis window, or before as_of, is an error", () => {
    const j = clone();
    svc(j, "RS92").review_by = "2027-02-26";
    expect(problems(j)).toContain("service RS92: review_by 2027-02-26 is later than 2027-02-25 (booking_site)");
    svc(j, "RS92").review_by = "2026-10-27";
    expect(problems(j)).toContain("service RS92: review_by is before as_of");
  });

  it("an observation without a month is an error", () => {
    const j = clone();
    svc(j, "RS92").observations[0].observed_month = null;
    expect(problems(j)).toContain("service RS92: booking_site observation regular has no month");
  });

  it("reports unknown destination, terminal, source and fare rule codes", () => {
    const j = clone();
    const s = svc(j, "RS92");
    s.destination_codes = ["D-NOPE"];
    s.terminal_code = "T99";
    s.source_codes = ["IC99"];
    s.fare_rule_codes = ["F99"];
    j.serviceLinks[0].destination_codes = ["D-GONE"];
    const p = problems(j);
    expect(p).toEqual(expect.arrayContaining([
      "service RS92 cites unknown destination D-NOPE",
      "service RS92 cites unknown terminal T99",
      "service RS92 cites unknown source IC99",
      "service RS92 cites unknown fare rule F99",
      "serviceLink RS01 cites unknown destination D-GONE",
    ]));
  });

  it("planned_not_funded on a service is an error; in datasetNotes it is fine", () => {
    const j = clone();
    svc(j, "RS90").notes = "planned_not_funded extension";
    expect(problems(j)).toContain("services: planned_not_funded is only allowed in datasetNotes");
  });

  it("not-running services need status_since; dated statuses need as_of, review_by and basis", () => {
    const j = clone();
    svc(j, "RS91").status_since = null;
    svc(j, "RS92").basis = null;
    const p = problems(j);
    expect(p).toContain("service RS91: suspended needs status_since");
    expect(p).toContain("service RS92: unconfirmed needs as_of, review_by and basis");
  });
});

describe("the real seed (data/source/research/naga-intercity-seed-2026-10-28.json)", () => {
  const raw: Json = JSON.parse(readFileSync("data/source/research/naga-intercity-seed-2026-10-28.json", "utf8"));
  const modes: Json = JSON.parse(readFileSync("data/source/research/naga-modes-seed-2026-10-16.json", "utf8"));
  const base: Json = JSON.parse(readFileSync("Data_Sets/naga_transport_seed.json", "utf8"));
  const imported = (rows: Json[]) => rows.filter((r) => r.review.decision === "import");
  const realCtx = {
    terminalCodes: imported(modes.terminals).map((t: Json) => t.code as string),
    fareRuleCodes: [...base.fare_rules.map((f: Json) => f.id as string), ...imported(modes.fareRules).map((f: Json) => f.code as string)],
    sourceCodes: modes.sources.map((s: Json) => s.code as string),
  };

  it("parses and validates with no problems", () => {
    expect(validateIntercitySeed(parseIntercitySeed(raw), realCtx)).toEqual([]);
  });

  it("every record has a decision and a reviewer", () => {
    const seed = parseIntercitySeed(raw);
    const records = [
      ...seed.sources, ...seed.destinations, ...seed.terminals, ...seed.services,
      ...seed.serviceLinks, ...seed.datasetNotes, ...seed.excluded,
    ];
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(["import", "exclude"]).toContain(r.review.decision);
      expect(r.review.reviewer.trim()).not.toBe("");
    }
  });

  it("RS06 no longer lists Bicol Isarog", () => {
    const rs06 = parseIntercitySeed(raw).services.find((s) => s.code === "RS06");
    expect(rs06?.operators).toEqual(["Philtranco"]);
    expect(JSON.stringify(rs06)).not.toMatch(/Bicol Isarog/i);
  });

  it("no service carries planned_not_funded", () => {
    expect(JSON.stringify(parseIntercitySeed(raw).services)).not.toContain("planned_not_funded");
  });

  it("pins the research copy by the sha256 of its LF-normalised text", () => {
    const [{ file, sha256 }] = parseIntercitySeed(raw).header.preparedFrom as [{ file: string; sha256: string }];
    expect(file).toBe("data/source/research/naga-intercity-research-2026-10-28.md");
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(text).digest("hex")).toBe(sha256);
  });
});

describe("importable / excluded / commit gate", () => {
  it("drops excluded records and lists them with reasons", () => {
    const j = clone();
    j.destinations[1].review.decision = "exclude";
    const seed = parseIntercitySeed(j);
    expect(importableIntercity(seed).destinations.map((d) => d.code)).toEqual(["D-SYN-A"]);
    expect(excludedIntercity(seed)).toEqual([
      "destinations D-SYN-HUB: synthetic",
      "excluded X-SYN-OLD: synthetic old listing",
    ]);
  });

  it("synthetic or draft seeds are refused for commit", () => {
    const seed = parseIntercitySeed(clone());
    expect(commitProblems(seed)).toEqual([
      "seed is synthetic",
      "reviewStatus is draft, owner_approved required",
    ]);
    const ok = clone();
    delete ok.header.synthetic;
    ok.header.reviewStatus = "owner_approved";
    expect(commitProblems(parseIntercitySeed(ok))).toEqual([]);
  });
});
