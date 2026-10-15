import { describe, expect, it } from "vitest";
import { locationAccessLabel, toLocationPermission } from "@/domain/device/location-permission";

describe("Settings → Location access row", () => {
  it("maps each permission state to its words", () => {
    expect(locationAccessLabel("granted")).toBe("Allowed");
    expect(locationAccessLabel("prompt")).toBe("Ask each time");
    expect(locationAccessLabel("denied")).toBe("Blocked");
    expect(locationAccessLabel("unsupported")).toBe("Not available");
  });

  it("treats any unknown state as not available", () => {
    for (const s of [undefined, null, "", "allowed", 1]) expect(toLocationPermission(s)).toBe("unsupported");
    for (const s of ["granted", "prompt", "denied"] as const) expect(toLocationPermission(s)).toBe(s);
  });
});
