import { describe, expect, it } from "vitest";
import { pickOpener } from "@/ui/kit/opener";

const el = (connected = true) => ({ isConnected: connected, contains: () => false }) as unknown as HTMLElement;
const body = el();

describe("pickOpener", () => {
  it("prefers the focused element (keyboard open)", () => {
    const focused = el();
    expect(pickOpener(focused, body, el())).toBe(focused);
  });
  it("falls back to the pressed element when focus is on body (Safari does not focus buttons on click)", () => {
    const pressed = el();
    expect(pickOpener(body, body, pressed)).toBe(pressed);
    expect(pickOpener(null, body, pressed)).toBe(pressed);
  });
  it("prefers the pressed control over a focusable ancestor Safari focused instead", () => {
    const pressed = el();
    const region = { isConnected: true, contains: (n: unknown) => n === pressed } as unknown as HTMLElement;
    expect(pickOpener(region, body, pressed)).toBe(pressed);
  });
  it("ignores a pressed element that left the page", () => {
    expect(pickOpener(body, body, el(false))).toBeNull();
  });
  it("is null when nothing opened it", () => {
    expect(pickOpener(body, body, null)).toBeNull();
  });
});
