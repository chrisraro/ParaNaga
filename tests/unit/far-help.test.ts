// Increment F, T6: Help "How trips are planned" and the Sources notes say what the far-area rules do, and honestly.
import { describe, expect, it } from "vitest";
import { rightsForSource } from "@/domain/sources/rights";
import { ARTICLES } from "@/ui/help/articles";
import { FAR_BASIS_NOTE } from "@/ui/help/sources-screen";

const body = ARTICLES.find((a) => a.slug === "how-trips-are-planned")!.body.join("\n");

describe("Help: how trips are planned", () => {
  it("explains far areas, the 600 m tricycle access, special trips, the vias and the TODAs", () => {
    expect(body).toContain("Cararayan and San Isidro, Pacol, Carolina and Panicuason");
    expect(body).toContain("local report, not an ordinance");
    expect(body).toContain("over 600 m");
    expect(body).toContain("“Tricycle, then Jeep R6”");
    expect(body).toContain("as the only tricycle card when no jeepney can be reached");
    expect(body).toContain("within 300 m");
    expect(body).toContain("R2 via Magsaysay, R3 via Roxas (Diversion) and R4 via Panganiban");
    expect(body).toContain("“Francia” (unconfirmed)");
    expect(body).toContain("no city list of TODAs");
    expect(body).toContain("could not confirm");
  });

  it("never promises a tricycle fare, a time or live service", () => {
    expect(body).not.toMatch(/arriv|live|real-time|e-jeep/i);
    expect(body).toContain("Tricycle time is not estimated");
  });
});

describe("Sources", () => {
  it("cites the owner report and the ordinances, and every new source has its rights row", () => {
    expect(FAR_BASIS_NOTE).toContain("U03");
    expect(FAR_BASIS_NOTE).toContain("RT25–RT32");
    for (const code of ["U03", "RT25", "RT26", "RT27", "RT28", "RT29", "RT30", "RT31", "RT32"]) {
      expect(rightsForSource(code), code).not.toBeNull();
    }
    expect(rightsForSource("U03")!.status).toBe("owner_report");
  });
});
