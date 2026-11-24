"use client";

// Step-up prompt (N3): shown when a protected action answered "step-up required". The person asks
// for a fresh email code (Neon Auth email OTP) and types it; the server records the verification
// for this session. Minimal on purpose: one short explanation, one button, one code field.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "@/ui/reports/reports.css";

import { useEffect, useId, useRef, useState } from "react";
import { sendStepUpCode, verifyStepUpCode, type StepUpResult } from "@/client/auth/step-up";
import { useT } from "@/i18n/provider";
import { updateThenFocus, useFieldError } from "@/ui/report/form-a11y";

// "resending": a new code was asked for from the code field; the field stays (a person may still
// hold a valid code) and a failed resend returns to "sent" with the error.
type Phase = "idle" | "sending" | "sent" | "resending" | "verifying";

export function StepUpPrompt({ onVerified, onCancel }: { onVerified: () => void; onCancel: () => void }) {
  const tt = useT();
  const t = tt.stepUp;
  const uid = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const { error, errorProps, fail, clear, edited, field } = useFieldError();
  const codeId = `${uid}-code`;
  const codeField = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const explain = (r: Exclude<StepUpResult, { ok: true }>) =>
    r.reason === "bad_code" ? t.badCode : r.reason === "rate_limited" ? t.rateLimited : r.reason === "signed_out" ? t.signedOut : t.failed;

  const onSend = async () => {
    if (phase !== "idle" && phase !== "sent") return;
    const resend = phase === "sent";
    setPhase(resend ? "resending" : "sending");
    clear();
    const r = await sendStepUpCode();
    if (r.ok) {
      updateThenFocus(() => setPhase("sent"), () => codeField.current);
      return;
    }
    setPhase(resend ? "sent" : "idle");
    fail(explain(r));
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase !== "sent") return;
    if (!code) return fail(tt.auth.enterCode, codeId);
    setPhase("verifying");
    clear();
    const r = await verifyStepUpCode(code);
    if (r.ok) {
      setCode("");
      onVerified();
      return;
    }
    setPhase("sent");
    fail(explain(r), r.reason === "bad_code" ? codeId : null);
  };

  const asked = phase !== "idle" && phase !== "sending";
  const busy = phase === "resending" || phase === "verifying";
  return (
    <section className="pn-reports__panel" aria-labelledby={`${uid}-t`} data-testid="step-up">
      <h3 ref={heading} tabIndex={-1} id={`${uid}-t`}>{t.title}</h3>
      <p className="pn-reports__note" role="status">{asked ? t.sent : t.body}</p>
      {asked ? (
        <form noValidate className="pn-report__field" onSubmit={(e) => void onVerify(e)}>
          <label htmlFor={codeId} className="pn-report__label">
            {t.codeLabel}
          </label>
          <input
            ref={codeField}
            {...field(codeId)}
            className="pn-report__input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              edited(codeId);
            }}
            data-testid="step-up-code"
          />
          <div className="pn-reports__actions">
            <button type="submit" className="pn-btn pn-btn--primary" aria-disabled={busy || undefined} data-testid="step-up-verify">
              {phase === "verifying" ? t.verifying : t.verify}
            </button>
            {/* aria-disabled, not disabled: the button keeps focus while its own request runs. */}
            <button type="button" className="pn-btn pn-btn--secondary" aria-disabled={busy} onClick={() => void onSend()} data-testid="step-up-resend">
              {phase === "resending" ? t.sending : t.resend}
            </button>
          </div>
        </form>
      ) : (
        <div className="pn-reports__actions">
          <button type="button" className="pn-btn pn-btn--primary" aria-disabled={phase === "sending" || undefined} onClick={() => void onSend()} data-testid="step-up-send">
            {phase === "sending" ? t.sending : t.send}
          </button>
          <button type="button" className="pn-btn pn-btn--secondary" onClick={onCancel} data-testid="step-up-cancel">
            {t.cancel}
          </button>
        </div>
      )}
      {error ? (
        <div {...errorProps} className="pn-report__error" data-testid="step-up-error">
          {error}
        </div>
      ) : null}
    </section>
  );
}
