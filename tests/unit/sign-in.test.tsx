// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInScreen } from "@/ui/auth/sign-in-screen";

const auth = vi.hoisted(() => ({
  configured: true,
  sendVerificationOtp: vi.fn(async () => ({})),
}));

vi.mock("@/client/auth/client", () => ({
  getAuthClient: () => (auth.configured ? { emailOtp: { sendVerificationOtp: auth.sendVerificationOtp } } : null),
}));

describe("SignInScreen (S21)", () => {
  beforeEach(() => {
    auth.configured = true;
    auth.sendVerificationOtp.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders explanation that account is optional and saved trips stay on phone", () => {
    render(<SignInScreen />);
    expect(screen.getByText("An account is optional.")).toBeTruthy();
    expect(
      screen.getByText(/Everything in ParaNaga works as a guest, and your saved trips stay on this phone./),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("progresses to OTP step when email is submitted", async () => {
    render(<SignInScreen />);
    const emailInput = screen.getByLabelText("Email address");
    fireEvent.change(emailInput, { target: { value: "commuter@example.com" } });
    fireEvent.click(screen.getByTestId("send-otp-btn"));

    await waitFor(() => {
      expect(screen.getByLabelText(/One-time code sent to commuter@example.com/)).toBeTruthy();
      expect(screen.getByTestId("verify-otp-btn")).toBeTruthy();
    });
  });

  it("allows switching back to change email", async () => {
    render(<SignInScreen />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "commuter@example.com" } });
    fireEvent.click(screen.getByTestId("send-otp-btn"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Use a different email" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));

    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Email address"));
  });

  it("never pretends to sign in when the auth service is not configured", async () => {
    auth.configured = false;
    render(<SignInScreen />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "commuter@example.com" } });
    fireEvent.click(screen.getByTestId("send-otp-btn"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not available right now/));
    expect(screen.queryByTestId("verify-otp-btn")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Signed in|code sent/i);
  });
});
