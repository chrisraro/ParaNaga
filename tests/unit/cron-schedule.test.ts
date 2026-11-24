// vercel.json crons (O2): Hobby allows one run a day per job and fires any time within the hour, so
// each job is daily, in its own hour, at low-traffic Manila time, on a route that exists.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions: string[]; crons: { path: string; schedule: string }[] };

describe("vercel.json", () => {
  it("schedules the job drain and the retention commit, and keeps the region", () => {
    expect(config.regions).toEqual(["sin1"]);
    expect(config.crons.map((c) => c.path)).toEqual(["/api/cron/jobs", "/api/cron/retention?mode=commit"]);
    for (const c of config.crons) expect(existsSync(`src/app${c.path.split("?")[0]}/route.ts`), c.path).toBe(true);
  });
  it("runs each once a day, in separate hours between 01:00 and 05:00 in Manila (UTC+8)", () => {
    const hours = config.crons.map((c) => Number(/^\d+ (\d+) \* \* \*$/.exec(c.schedule)?.[1]));
    expect(new Set(hours).size).toBe(hours.length);
    for (const h of hours) {
      expect((h + 8) % 24).toBeGreaterThanOrEqual(1);
      expect((h + 8) % 24).toBeLessThan(5);
    }
  });
});
