"use client";

import "@/ui/kit/styles";
import "@/ui/auth/sign-in.css";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getAuthClient } from "@/client/auth/client";
import type { Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";

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
function friendlyAuthError(message: string | undefined, fallback: string, t: Dict["auth"]): string {
  if (!message) return fallback;
  if (/invalid origin/i.test(message)) return t.errOrigin;
  if (/too many|rate/i.test(message)) return t.errRate;
  if (/invalid|expired|otp/i.test(message)) return t.errCode;
  return fallback;
}

export function SignInScreen() {
  const tt = useT();
  const t = tt.auth;
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const backToEmail = useRef(false);

  // "Use a different email" unmounts the code form: put focus back on the email field.
  useEffect(() => {
    if (step === "email" && backToEmail.current) {
      backToEmail.current = false;
      emailRef.current?.focus();
    }
  }, [step]);

  const fail = (error: { message?: string } | null | undefined, fallback: string) =>
    setStatus({ type: "error", message: friendlyAuthError(error?.message, fallback, t) });

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const client = (await getAuthClient()) as AuthClientLike | null;
      // Never report success unless the service answered without an error.
      if (!client?.emailOtp?.sendVerificationOtp) {
        fail(null, t.unavailable);
        return;
      }
      const res = await client.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
      if (!res || res.error) {
        fail(res?.error, t.sendFailed);
        return;
      }
      setStatus({ type: "success", message: t.codeSent(email.trim()) });
      setStep("otp");
    } catch {
      fail(null, t.sendNetwork);
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
      const client = (await getAuthClient()) as AuthClientLike | null;
      if (!client?.signIn?.emailOtp) {
        fail(null, t.unavailable);
        return;
      }
      const res = await client.signIn.emailOtp({ email: email.trim(), otp: otp.trim() });
      if (!res || res.error) {
        fail(res?.error, t.codeFailed);
        return;
      }
      setStatus({ type: "success", message: t.signedIn });
      window.location.href = "/app/more";
    } catch {
      fail(null, t.verifyFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const client = (await getAuthClient()) as AuthClientLike | null;
      if (!client?.signIn?.social) {
        fail(null, t.googleUnavailable);
        return;
      }
      // Absolute, so Neon sends the browser back to this site (its host is a trusted origin) and not to its own.
      const res = await client.signIn.social({ provider: "google", callbackURL: `${window.location.origin}/app/more` });
      if (res?.error) fail(res.error, t.googleFailed);
    } catch {
      fail(null, t.googleFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pn-signin" data-testid="sign-in-screen">
      <div className="pn-signin__intro">
        <p className="pn-signin__lead">{t.lead}</p>
        <p className="pn-signin__body">
          {t.body}
        </p>
      </div>

      <div className="pn-card pn-signin__card">
        {status && (
          <div className={`pn-signin__status pn-signin__status--${status.type}`} role={status.type === "error" ? "alert" : "status"}>
            {status.message}
          </div>
        )}

        {step === "email" ? (
          <form className="pn-signin__form" onSubmit={handleSendOtp}>
            <div className="pn-signin__field">
              <label htmlFor="signin-email" className="pn-signin__label">
                {t.emailLabel}
              </label>
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                ref={emailRef}
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
              {busy ? t.sendingCode : t.continueEmail}
            </button>
          </form>
        ) : (
          <form className="pn-signin__form" onSubmit={handleVerifyOtp}>
            <div className="pn-signin__field">
              <label htmlFor="signin-otp" className="pn-signin__label">
                {t.codeLabel(email)}
              </label>
              <input
                id="signin-otp"
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
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
              {busy ? t.verifying : t.verify}
            </button>
            <button
              type="button"
              className="pn-btn pn-btn--secondary"
              onClick={() => {
                backToEmail.current = true;
                setStep("email");
                setStatus(null);
              }}
              disabled={busy}
            >
              {t.differentEmail}
            </button>
          </form>
        )}

        <div className="pn-signin__divider" aria-hidden="true">
          <span>{t.or}</span>
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
          {t.google}
        </button>
      </div>

      <p className="pn-signin__guest-note">
        {t.guestQuestion}{" "}
        <Link href="/app" className="pn-signin__guest-link">
          {t.returnToMap}
        </Link>
      </p>
    </div>
  );
}
