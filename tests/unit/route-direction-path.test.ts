import { describe, expect, it } from "vitest";
import { linesSchema, type Lines } from "@/domain/api/schemas";
import { routeDirectionPath } from "@/ui/map/line-rules";
import linesFixture from "../e2e/fixtures/network/lines.json";

const LINES: Lines = linesSchema.parse(linesFixture);

describe("routeDirectionPath (T12-3: no fallback to the other direction)", () => {
  it("picks the line of the selected direction", () => {
    const inbound = routeDirectionPath(LINES, "R1", true, "inbound");
    const outbound = routeDirectionPath(LINES, "R1", true, "outbound");
    expect(inbound.line?.direction).toBe("inbound");
    expect(outbound.line?.direction).toBe("outbound");
  });

  it("returns no line for an untraced selected direction, even when the other direction is drawn", () => {
    const outboundUntraced: Lines = {
      ...LINES,
      lines: LINES.lines.filter((l) => !(l.routeCode === "R1" && l.direction === "outbound")),
      untraced: [
        ...LINES.untraced,
        { ...LINES.untraced[0]!, routeCode: "R1", direction: "outbound", variantId: "22222222-2222-4222-8222-222222222222" },
      ],
    };
    const picked = routeDirectionPath(outboundUntraced, "R1", true, "outbound");
    expect(picked.line).toBeNull();
    expect(picked.untraced?.message).toBe("Path could not be traced from the street list");
    expect(routeDirectionPath(outboundUntraced, "R1", true, "inbound").line?.direction).toBe("inbound");
  });

  it("returns no line (and no other route's) when the selected direction has neither a line nor an untraced entry", () => {
    const noOutbound: Lines = { ...LINES, lines: LINES.lines.filter((l) => !(l.routeCode === "R1" && l.direction === "outbound")) };
    expect(routeDirectionPath(noOutbound, "R1", true, "outbound")).toEqual({ line: null, untraced: null });
  });

  it("uses the route's single line for a circuit, and the untraced entry when it has none", () => {
    expect(routeDirectionPath(LINES, "R3", false, "inbound").line?.direction).toBe("circuit");
    const tri = routeDirectionPath(LINES, "TRI-VISTODA", false, "inbound");
    expect(tri.line).toBeNull();
    expect(tri.untraced?.routeCode).toBe("TRI-VISTODA");
    expect(routeDirectionPath(null, "R3", false, "inbound")).toEqual({ line: null, untraced: null });
  });
});
