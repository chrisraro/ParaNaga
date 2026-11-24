import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// Sign-in by email code: errors tied to their field, focus kept, resend with a wait. The auth
// service is answered with page routes.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

async function open(page: Page) {
  const sends: string[] = [];
  const codes: unknown[] = [];
  await page.clock.install();
  await routeNetwork(page);
  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) }));
  await page.route("**/api/auth/**", (route) => {
    const url = route.request().url();
    if (url.includes("sign-in/email-otp")) {
      codes.push((route.request().postDataJSON() as { otp: unknown }).otp);
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "INVALID_OTP", message: "Invalid OTP" }) });
    }
    if (url.includes("send-verification-otp")) sends.push(url);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  await page.goto("/app/sign-in");
  await expect(page.getByTestId("sign-in-screen")).toBeVisible();
  return { sends, codes };
}

test("errors are tied to the field, a spaced code works and a wrong code keeps focus", async ({ page }) => {
  const { codes } = await open(page);
  const email = page.locator("#signin-email");
  await page.getByTestId("send-otp-btn").click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription(/Enter your email address/);

  await email.fill("a@example.com");
  await expect(email).toHaveAttribute("aria-invalid", "false");
  await page.getByTestId("send-otp-btn").click();
  const code = page.locator("#signin-otp");
  await expect(code).toBeFocused();
  await page.getByTestId("verify-otp-btn").click();
  await expect(code).toHaveAccessibleDescription(/Enter the code/);

  await code.fill("123 456");
  await expect(code).toHaveValue("123456");
  await page.getByTestId("verify-otp-btn").click();
  await expect(code).toHaveAccessibleDescription(/did not work/);
  await expect(code).toBeFocused();
  expect(codes).toEqual(["123456"]);
});

test("a new code can be asked for after the wait", async ({ page }) => {
  const { sends } = await open(page);
  await page.locator("#signin-email").fill("a@example.com");
  await page.getByTestId("send-otp-btn").click();
  const resend = page.getByTestId("resend-otp-btn");
  await expect(resend).toHaveAttribute("aria-disabled", "true");
  // aria-disabled: still focusable, and pressing it says how long is left.
  await resend.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: /Wait \d+ more second/ })).toBeVisible();
  expect(sends).toHaveLength(1);

  await page.clock.fastForward(31_000);
  await expect(resend).not.toHaveAttribute("aria-disabled", "true");
  await resend.click();
  await expect(page.getByRole("status").filter({ hasText: "New code sent to a@example.com." })).toBeVisible();
  await expect(resend).toBeFocused();
  expect(sends).toHaveLength(2);
});
