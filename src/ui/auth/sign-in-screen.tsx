"use client";

import "@/ui/kit/styles";
import "@/ui/auth/sign-in.css";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getAuthClient } from "@/client/auth/client";
import { clearReportDraft } from "@/client/corrections/draft";
import { safeReturnPath } from "@/domain/auth/return-path";
import type { Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { useFieldError } from "@/ui/report/form-a11y";

type AuthResult = { error?: { message?: string } | null } | undefined | null;

/** The slice of the Neon Auth client this screen uses; any method may be missing on a misconfigured service. */
type AuthClientLike = {
  emailOtp?: { sendVerificationOtp?: (args: { email: string; type: string }) => Promise<AuthResult> };
  signIn?: {
    emailOtp?: (args: { email: string; otp: string }) => Promise<AuthResult>;
    social?: (args: { provider: string; callbackURL: string }) => Promise<AuthResult>;
  };
};

/** A new code can be asked for this long after the last one. */
const RESEND_SECONDS = 30;

/** Turns the service's technical messages into calm copy; unknown messages fall back to ours. */
function friendlyAuthError(message: string | undefined, fallback: string, t: Dict["auth"]): string {
  if (!message) return fallback;
  if (/invalid origin/i.test(message)) return t.errOrigin;
  if (/too many|rate/i.test(message)) return t.errRate;
  if (/expired|otp/i.test(message)) return t.errCode;
  return fallback;
}

/** The Neon client throws the service's refusals (a wrong code, too many tries) as well as network failures. */
const thrown = (e: unknown) => (e instanceof Error ? e : null);

/** The page to open once signed in. Read when it is needed, so the page itself stays static. */
function returnPath(): string {
  return safeReturnPath(new URLSearchParams(window.location.search).get("next")) ?? "/app/more";
}

export function SignInScreen() {
  const tt = useT();
  const t = tt.auth;
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState<null | "send" | "verify" | "google">(null);
  const [status, setStatus] = useState<string | null>(null);
  const { error, errorProps, fail, clear, edited, field } = useFieldError();
  // When the next code may be asked for (ms); null once the wait is over.
  const [resendAt, setResendAt] = useState<number | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const backToEmail = useRef(false);

  // A sign-in that does not go back to the report (from Settings, say): whatever an earlier guest
  // left on the way to signing in is not this person's.
  useEffect(() => {
    if (!returnPath().startsWith("/app/report")) clearReportDraft();
  }, []);

  // "Use a different email" unmounts the code form: put focus back on the email field.
  useEffect(() => {
    if (step === "email" && backToEmail.current) {
      backToEmail.current = false;
      emailRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (resendAt === null) return undefined;
    const timer = setTimeout(() => setResendAt(null), Math.max(0, resendAt - Date.now()));
    return () => clearTimeout(timer);
  }, [resendAt]);

  const start = (what: "send" | "verify" | "google") => {
    setBusy(what);
    setStatus(null);
    clear();
  };
  const sayFailed = (authError: { message?: string } | null | undefined, fallback: string) => fail(friendlyAuthError(authError?.message, fallback, t));

  const sayCodeFailed = (authError: { message?: string } | null | undefined, fallback: string) => {
    const message = friendlyAuthError(authError?.message, fallback, t);
    fail(message, message === t.errCode || message === t.codeFailed ? "signin-otp" : null);
  };

  const sendCode = async (resend: boolean) => {
    start("send");
    try {
      const client = (await getAuthClient()) as AuthClientLike | null;
      // Never report success unless the service answered without an error.
      if (!client?.emailOtp?.sendVerificationOtp) {
        sayFailed(null, t.unavailable);
        return;
      }
      const res = await client.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
      if (!res || res.error) {
        sayFailed(res?.error, t.sendFailed);
        return;
      }
      setStatus(resend ? t.codeSentAgain(email.trim()) : t.codeSent(email.trim()));
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setStep("otp");
    } catch (e) {
      sayFailed(thrown(e), t.sendNetwork);
    } finally {
      setBusy(null);
    }
  };

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || emailRef.current?.validity.valid === false) return fail(t.enterEmail, "signin-email");
    void sendCode(false);
  };

  const handleResend = () => {
    if (busy) return;
    // The wait is said once, when the button is pressed, not counted down out loud.
    if (resendAt !== null) {
      clear();
      return setStatus(t.resendWait(Math.max(1, Math.ceil((resendAt - Date.now()) / 1000))));
    }
    void sendCode(true);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!otp) return fail(t.enterCode, "signin-otp");
    start("verify");
    try {
      const client = (await getAuthClient()) as AuthClientLike | null;
      if (!client?.signIn?.emailOtp) {
        sayFailed(null, t.unavailable);
        return;
      }
      const res = await client.signIn.emailOtp({ email: email.trim(), otp });
      if (!res || res.error) return sayCodeFailed(res?.error, t.codeFailed);
      setStatus(t.signedIn);
      window.location.href = returnPath();
    } catch (e) {
      sayCodeFailed(thrown(e), t.verifyFailed);
    } finally {
      setBusy(null);
    }
  };

  const handleGoogleSignIn = async () => {
    if (busy) return;
    start("google");
    try {
      const client = (await getAuthClient()) as AuthClientLike | null;
      if (!client?.signIn?.social) {
        sayFailed(null, t.googleUnavailable);
        return;
      }
      // Absolute, so Neon sends the browser back to this site (its host is a trusted origin) and not to its own.
      const res = await client.signIn.social({ provider: "google", callbackURL: `${window.location.origin}${returnPath()}` });
      if (res?.error) sayFailed(res.error, t.googleFailed);
    } catch (e) {
      sayFailed(thrown(e), t.googleFailed);
    } finally {
      setBusy(null);
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
        {/* Always in the page, so each message in it is announced. */}
        <div className="pn-signin__live" role="status">
          {status && !error ? <div className="pn-signin__status pn-signin__status--success">{status}</div> : null}
        </div>
        {error ? (
          <div {...errorProps} className="pn-signin__status pn-signin__status--error">
            {error}
          </div>
        ) : null}

        {step === "email" ? (
          // Keyed: without it React turns the email form into the code form in place, the code field
          // never mounts (no autofocus) and focus stays on the button.
          <form key="email" className="pn-signin__form" noValidate onSubmit={handleSendOtp}>
            <div className="pn-signin__field">
              <label htmlFor="signin-email" className="pn-signin__label">
                {t.emailLabel}
              </label>
              <input
                {...field("signin-email")}
                type="email"
                required
                autoComplete="email"
                ref={emailRef}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  edited("signin-email");
                }}
                className="pn-signin__input"
                readOnly={busy !== null}
              />
            </div>
            <button
              type="submit"
              className="pn-btn pn-btn--primary pn-signin__btn"
              aria-disabled={busy !== null || undefined}
              data-testid="send-otp-btn"
            >
              {busy === "send" ? t.sendingCode : t.continueEmail}
            </button>
          </form>
        ) : (
          <form key="otp" className="pn-signin__form" noValidate onSubmit={handleVerifyOtp}>
            <div className="pn-signin__field">
              <label htmlFor="signin-otp" className="pn-signin__label">
                {t.codeLabel(email)}
              </label>
              <input
                {...field("signin-otp")}
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, "")); // a pasted "123 456" works
                  edited("signin-otp");
                }}
                className="pn-signin__input"
                readOnly={busy !== null}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="pn-btn pn-btn--primary pn-signin__btn"
              aria-disabled={busy !== null || undefined}
              data-testid="verify-otp-btn"
            >
              {busy === "verify" ? t.verifying : t.verify}
            </button>
            <button
              type="button"
              className="pn-btn pn-btn--secondary"
              onClick={handleResend}
              aria-disabled={busy !== null || resendAt !== null || undefined}
              aria-describedby={resendAt !== null ? "signin-resend-hint" : undefined}
              data-testid="resend-otp-btn"
            >
              {busy === "send" ? t.sendingCode : tt.stepUp.resend}
            </button>
            {resendAt !== null ? (
              <p id="signin-resend-hint" className="pn-signin__body">
                {t.resendHint(RESEND_SECONDS)}
              </p>
            ) : null}
            <button
              type="button"
              className="pn-btn pn-btn--secondary"
              onClick={() => {
                if (busy) return;
                backToEmail.current = true;
                setStep("email");
                setStatus(null);
                clear();
              }}
              aria-disabled={busy !== null || undefined}
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
          aria-disabled={busy !== null || undefined}
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
