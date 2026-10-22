"use client";

// Step-up prompt (N3): shown when a protected action answered "step-up required". The person asks
// for a fresh email code (Neon Auth email OTP) and types it; the server records the verification
// for this session. Minimal on purpose: one short explanation, one button, one code field.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "@/ui/reports/reports.css";

import { useId, useState } from "react";
import { sendStepUpCode, verifyStepUpCode, type StepUpResult } from "@/client/auth/step-up";
import { useT } from "@/i18n/provider";

type Phase = "idle" | "sending" | "sent" | "verifying";

export function StepUpPrompt({ onVerified, onCancel }: { onVerified: () => void; onCancel: () => void }) {
  const t = useT().stepUp;
  const uid = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const explain = (r: Exclude<StepUpResult, { ok: true }>) =>
    r.reason === "bad_code" ? t.badCode : r.reason === "rate_limited" ? t.rateLimited : r.reason === "signed_out" ? t.signedOut : t.failed;

  const onSend = async () => {
    setPhase("sending");
    setError("");
    const r = await sendStepUpCode();
    if (r.ok) {
      setPhase("sent");
      return;
    }
    setPhase("idle");
    setError(explain(r));
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setPhase("verifying");
    setError("");
    const r = await verifyStepUpCode(code);
    if (r.ok) {
      setCode("");
      onVerified();
      return;
    }
    setPhase("sent");
    setError(explain(r));
  };

  const asked = phase === "sent" || phase === "verifying";
  return (
    <section className="pn-reports__panel" aria-labelledby={`${uid}-t`} data-testid="step-up">
      <h3 id={`${uid}-t`}>{t.title}</h3>
      <p className="pn-reports__note">{asked ? t.sent : t.body}</p>
      {asked ? (
        <form className="pn-report__field" onSubmit={(e) => void onVerify(e)}>
          <label htmlFor={`${uid}-code`} className="pn-report__label">
            {t.codeLabel}
          </label>
          <input
            id={`${uid}-code`}
            className="pn-report__input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="step-up-code"
          />
          <div className="pn-reports__actions">
            <button type="submit" className="pn-btn pn-btn--primary" disabled={phase === "verifying" || !code.trim()} data-testid="step-up-verify">
              {phase === "verifying" ? t.verifying : t.verify}
            </button>
            <button type="button" className="pn-btn pn-btn--secondary" disabled={phase === "verifying"} onClick={() => void onSend()} data-testid="step-up-resend">
              {t.resend}
            </button>
          </div>
        </form>
      ) : (
        <div className="pn-reports__actions">
          <button type="button" className="pn-btn pn-btn--primary" disabled={phase === "sending"} onClick={() => void onSend()} data-testid="step-up-send">
            {phase === "sending" ? t.sending : t.send}
          </button>
          <button type="button" className="pn-btn pn-btn--secondary" onClick={onCancel} data-testid="step-up-cancel">
            {t.cancel}
          </button>
        </div>
      )}
      {error ? (
        <div className="pn-report__error" role="alert" data-testid="step-up-error">
          {error}
        </div>
      ) : null}
    </section>
  );
}
