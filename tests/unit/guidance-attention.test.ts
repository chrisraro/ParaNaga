import { describe, expect, it } from "vitest";
import { newAttention } from "@/client/guidance/attention";
import type { GuidanceView } from "@/domain/guidance/view";

const ride = (key: string | null) =>
  ({ screen: "ride", attention: key ? { key, title: "Para! Next stop is yours", body: "b" } : null }) as unknown as GuidanceView;

describe("newAttention", () => {
  it("fires once on the transition, not on later renders or fixes", () => {
    expect(newAttention(ride(null), ride("ride:1:para"))?.title).toBe("Para! Next stop is yours");
    expect(newAttention(ride("ride:1:para"), ride("ride:1:para"))).toBeNull();
  });

  it("does not fire for no alert, and resets per step", () => {
    expect(newAttention(null, ride(null))).toBeNull();
    expect(newAttention(ride("ride:1:para"), ride(null))).toBeNull();
    expect(newAttention(ride(null), ride("ride:1:para"))).not.toBeNull();
    expect(newAttention(ride("ride:1:para"), ride("ride:3:para"))).not.toBeNull();
  });
});
