// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInScreen } from "@/ui/auth/sign-in-screen";

const auth = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/client/auth/client", () => ({ getAuthClient: () => auth.client }));

function fakeClient(over: { send?: unknown; verify?: unknown; social?: unknown } = {}) {
  return {
    emailOtp: { sendVerificationOtp: over.send ?? vi.fn(async () => ({ data: { success: true }, error: null })) },
    signIn: {
      emailOtp: over.verify ?? vi.fn(async () => ({ data: {}, error: null })),
      social: over.social ?? vi.fn(async () => ({ data: {}, error: null })),
    },
  };
}

async function submitEmail() {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "commuter@example.com" } });
  fireEvent.click(screen.getByTestId("send-otp-btn"));
}

describe("SignInScreen (S21)", () => {
  beforeEach(() => {
    auth.client = fakeClient();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders explanation that account is optional and saved trips stay on phone", () => {
    render(<SignInScreen />);
    expect(screen.getByText("An account is optional.")).toBeTruthy();
    expect(screen.getByText(/Everything in ParaNaga works as a guest, and your saved trips stay on this phone./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("moves to the code step only after the service accepts the email", async () => {
    render(<SignInScreen />);
    await submitEmail();
    await waitFor(() => {
      expect(screen.getByLabelText(/One-time code sent to commuter@example.com/)).toBeTruthy();
      expect(screen.getByTestId("verify-otp-btn")).toBeTruthy();
    });
  });

  it("stays on the email step and explains an invalid-origin refusal calmly", async () => {
    auth.client = fakeClient({ send: vi.fn(async () => ({ data: null, error: { message: "Invalid origin" } })) });
    render(<SignInScreen />);
    await submitEmail();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not set up for this address/i));
    expect(screen.queryByTestId("verify-otp-btn")).toBeNull();
    expect(screen.queryByText(/Verification code sent/)).toBeNull();
  });

  it("never says the code was sent when the client has no email-code method", async () => {
    auth.client = { signIn: {} };
    render(<SignInScreen />);
    await submitEmail();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not available right now/i));
    expect(screen.queryByTestId("verify-otp-btn")).toBeNull();
  });

  it("never says it signed in when there is no client", async () => {
    auth.client = null;
    render(<SignInScreen />);
    await submitEmail();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not available right now/i));
    expect(screen.queryByText(/Signed in/)).toBeNull();
  });

  it("shows a wrong-code error and does not redirect", async () => {
    auth.client = fakeClient({ verify: vi.fn(async () => ({ data: null, error: { message: "Invalid OTP" } })) });
    render(<SignInScreen />);
    await submitEmail();
    await waitFor(() => expect(screen.getByTestId("verify-otp-btn")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/One-time code/), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("verify-otp-btn"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/code did not work/i));
    expect(screen.queryByText(/Signed in/)).toBeNull();
  });

  it("allows switching back to change email", async () => {
    render(<SignInScreen />);
    await submitEmail();
    await waitFor(() => expect(screen.getByRole("button", { name: "Use a different email" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });

  it("reports a Google start failure instead of staying silent", async () => {
    auth.client = fakeClient({ social: vi.fn(async () => ({ data: null, error: { message: "boom" } })) });
    render(<SignInScreen />);
    fireEvent.click(screen.getByTestId("google-sign-in-btn"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Could not start Google sign-in/));
  });
});
