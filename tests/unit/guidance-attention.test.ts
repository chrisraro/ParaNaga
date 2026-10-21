import { describe, expect, it } from "vitest";
import { newAttention } from "@/client/guidance/attention";
import type { GuidanceView } from "@/domain/guidance/view";

const ride = (key: string | null) =>
  ({ screen: "ride", attention: key ? { key, title: "Para! Next stop is yours", body: "b" } : null }) as unknown as GuidanceView;

describe("newAttention", () => {
  it("fires a key once per trip, even when GPS drops it and brings it back", () => {
    const fired = new Set<string>();
    expect(newAttention(fired, ride("ride:1:para"))?.title).toBe("Para! Next stop is yours");
    fired.add("ride:1:para");
    expect(newAttention(fired, ride("ride:1:para"))).toBeNull();
    expect(newAttention(fired, ride(null))).toBeNull();
    expect(newAttention(fired, ride("ride:1:para"))).toBeNull();
  });

  it("the heads-up at 3 and at 2 stops left fire once each (GPS wobble between them never re-fires)", () => {
    const fired = new Set<string>();
    const views = ["ride:1:ready:3", "ride:1:ready:3", "ride:1:ready:2", "ride:1:ready:2", "ride:1:para"].map(ride);
    const keys = views.flatMap((v) => {
      const a = newAttention(fired, v);
      if (!a) return [];
      fired.add(a.key);
      return [a.key];
    });
    expect(keys).toEqual(["ride:1:ready:3", "ride:1:ready:2", "ride:1:para"]);
  });

  it("fires again for a later step", () => {
    expect(newAttention(new Set(["ride:1:para"]), ride("ride:3:para"))).not.toBeNull();
    expect(newAttention(new Set(), null)).toBeNull();
  });
});
