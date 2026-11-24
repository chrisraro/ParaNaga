import { describe, expect, it } from "vitest";
import { safeReturnPath, signInHref } from "@/domain/auth/return-path";
import { opensOnLargeScreen } from "@/domain/device/viewport-gate";

describe("safeReturnPath", () => {
  it.each(["/app", "/app/report?type=stop&id=a%26b&label=Plaza%20Rizal", "/admin/moderation"])("keeps %s", (p) => {
    expect(safeReturnPath(p)).toBe(p);
    expect(safeReturnPath(new URL(signInHref(p), "https://x.test").searchParams.get("next"))).toBe(p);
  });

  it.each([
    null,
    "",
    "https://evil.test/app",
    "//evil.test/app",
    "/\evil.test/app",
    "/\t/evil.test/app",
    "javascript:alert(1)",
    "/app/../api/auth/sign-out",
    "/application",
    "/",
    "/app/sign-in?next=/app",
    `/app/${"x".repeat(1000)}`,
  ])("refuses %s", (p) => expect(safeReturnPath(p)).toBeNull());
});

describe("opensOnLargeScreen", () => {
  it.each(["/app/sign-in", "/app/more", "/app/help", "/app/help/sources"])("opens %s", (p) => expect(opensOnLargeScreen(p)).toBe(true));
  it.each(["/app", "/app/explore", "/app/report", "/app/helpers"])("gates %s", (p) => expect(opensOnLargeScreen(p)).toBe(false));
});
