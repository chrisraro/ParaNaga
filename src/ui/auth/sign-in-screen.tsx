"use client";

import "@/ui/kit/styles";
import "@/ui/auth/sign-in.css";

import { useState } from "react";
import Link from "next/link";
import { getAuthClient } from "@/client/auth/client";

type AuthResult = { error?: { message?: string } | null } | undefined | null;

/** The slice of the Neon Auth client this screen uses; any method may be missing on a misconfigured service. */
type AuthClientLike = {
  emailOtp?: { sendVerificationOtp?: (args: { email: string; type: string }) => Promise<AuthResult> };
  signIn?: {
    emailOtp?: (args: { email: string; otp: string }) => Promise<AuthResult>;
    social?: (args: { provider: string; callbackURL: string }) => Promise<AuthResult>;
  };
};

/** Turns the service's technical messages into calm copy; unknown messages fall back to ours. */
function friendlyAuthError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (/invalid origin/i.test(message)) return "Sign-in is not set up for this address yet. You can keep using ParaNaga as a guest.";
  if (/too many|rate/i.test(message)) return "Too many tries. Please wait a minute and try again.";
  if (/invalid|expired|otp/i.test(message)) return "That code did not work. Check it, or ask for a new one.";
  return fallback;
}

export function SignInScreen() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const fail = (error: { message?: string } | null | undefined, fallback: string) =>
    setStatus({ type: "error", message: friendlyAuthError(error?.message, fallback) });

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const client = getAuthClient() as AuthClientLike | null;
      // Never report success unless the service answered without an error.
      if (!client?.emailOtp?.sendVerificationOtp) {
        fail(null, "Sign-in is not available right now. You can keep using ParaNaga as a guest.");
        return;
      }
      const res = await client.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
      if (!res || res.error) {
        fail(res?.error, "Could not send the code. Please try again.");
        return;
      }
      setStatus({ type: "success", message: `Verification code sent to ${email.trim()}.` });
      setStep("otp");
    } catch {
      fail(null, "Network error sending the code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const client = getAuthClient() as AuthClientLike | null;
      if (!client?.signIn?.emailOtp) {
        fail(null, "Sign-in is not available right now. You can keep using ParaNaga as a guest.");
        return;
      }
      const res = await client.signIn.emailOtp({ email: email.trim(), otp: otp.trim() });
      if (!res || res.error) {
        fail(res?.error, "That code did not work. Check it and try again.");
        return;
      }
      setStatus({ type: "success", message: "Signed in. Redirecting..." });
      window.location.href = "/app/more";
    } catch {
      fail(null, "Could not verify the code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const client = getAuthClient() as AuthClientLike | null;
      if (!client?.signIn?.social) {
        fail(null, "Google sign-in is not available right now.");
        return;
      }
      // Absolute, so Neon sends the browser back to this site (its host is a trusted origin) and not to its own.
      const res = await client.signIn.social({ provider: "google", callbackURL: `${window.location.origin}/app/more` });
      if (res?.error) fail(res.error, "Could not start Google sign-in.");
    } catch {
      fail(null, "Could not start Google sign-in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pn-signin" data-testid="sign-in-screen">
      <div className="pn-signin__intro">
        <p className="pn-signin__lead">An account is optional.</p>
        <p className="pn-signin__body">
          Everything in ParaNaga works as a guest, and your saved trips stay on this phone. Signing in lets you contribute community posts, report corrections, and sync your data.
        </p>
      </div>

      <div className="pn-card pn-signin__card">
        {status && (
          <div className={`pn-signin__status pn-signin__status--${status.type}`} role="status">
            {status.message}
          </div>
        )}

        {step === "email" ? (
          <form className="pn-signin__form" onSubmit={handleSendOtp}>
            <div className="pn-signin__field">
              <label htmlFor="signin-email" className="pn-signin__label">
                Email address
              </label>
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pn-signin__input"
                disabled={busy}
              />
            </div>
            <button
              type="submit"
              className="pn-btn pn-btn--primary pn-signin__btn"
              disabled={busy || !email.trim()}
              data-testid="send-otp-btn"
            >
              {busy ? "Sending code..." : "Continue with Email"}
            </button>
          </form>
        ) : (
          <form className="pn-signin__form" onSubmit={handleVerifyOtp}>
            <div className="pn-signin__field">
              <label htmlFor="signin-otp" className="pn-signin__label">
                One-time code sent to {email}
              </label>
              <input
                id="signin-otp"
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="pn-signin__input"
                disabled={busy}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="pn-btn pn-btn--primary pn-signin__btn"
              disabled={busy || !otp.trim()}
              data-testid="verify-otp-btn"
            >
              {busy ? "Verifying..." : "Verify & Sign in"}
            </button>
            <button
              type="button"
              className="pn-btn pn-btn--secondary"
              onClick={() => {
                setStep("email");
                setStatus(null);
              }}
              disabled={busy}
            >
              Use a different email
            </button>
          </form>
        )}

        <div className="pn-signin__divider" aria-hidden="true">
          <span>or</span>
        </div>

        <button
          type="button"
          className="pn-signin__google-btn"
          onClick={handleGoogleSignIn}
          disabled={busy}
          data-testid="google-sign-in-btn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </button>
      </div>

      <p className="pn-signin__guest-note">
        Want to stay a guest?{" "}
        <Link href="/app" className="pn-signin__guest-link">
          Return to map
        </Link>
      </p>
    </div>
  );
}
