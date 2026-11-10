"use client";

import { useId, useState } from "react";
import { sendStepUpCode, verifyStepUpCode, type StepUpResult } from "@/client/auth/step-up";
import { btnPrimary, btnSecondary, confirmCls, ErrorNote, inputCls, Muted } from "./parts";

// Step-up for publish and rollback (N3 flow, English for the admin console): a fresh email code,
// checked by the server and recorded for this session for 15 minutes.
type Phase = "idle" | "sending" | "sent" | "verifying";

const explain = (r: Exclude<StepUpResult, { ok: true }>) =>
  r.reason === "bad_code"
    ? "That code did not work. Check it, or ask for a new one."
    : r.reason === "rate_limited"
      ? "Too many tries. Wait a while, then ask for a new code."
      : r.reason === "signed_out"
        ? "You are signed out. Sign in again."
        : "The code could not be sent or checked. Try again.";

/** `nested`: inside a confirm panel that is already the amber step, it is a ruled part of that panel, not a second box. */
export function AdminStepUp({ action, onVerified, onCancel, nested = false }: { action: string; onVerified: () => void; onCancel: () => void; nested?: boolean }) {
  const uid = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const send = async () => {
    setPhase("sending");
    setError("");
    const r = await sendStepUpCode();
    if (r.ok) return setPhase("sent");
    setPhase("idle");
    setError(explain(r));
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setPhase("verifying");
    setError("");
    const r = await verifyStepUpCode(code);
    if (r.ok) {
      // Back to the start: if the parent keeps this mounted and the retry needs a code again, it must be usable.
      setPhase("idle");
      setCode("");
      return onVerified();
    }
    setPhase("sent");
    setError(explain(r));
  };
  const asked = phase === "sent" || phase === "verifying";

  return (
    <section
      aria-labelledby={`${uid}-t`}
      className={`mt-4 grid gap-3 ${nested ? "border-t border-accent-line pt-4 dark:border-accent/50" : `p-5 ${confirmCls}`}`}
      data-testid="admin-step-up"
    >
      <h3 id={`${uid}-t`} className="font-semibold">
        Confirm it is you
      </h3>
      <Muted>
        {asked
          ? "We emailed you a code. Enter it to continue."
          : `To ${action}, enter a fresh code from your email. It counts for 15 minutes on this device.`}
      </Muted>
      {asked ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void verify(e)}>
          <label htmlFor={`${uid}-code`} className="grid w-40 gap-1.5 text-sm font-semibold">
            Code
            <input
              id={`${uid}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputCls} font-normal tabular-nums`}
              data-testid="admin-step-up-code"
            />
          </label>
          <button type="submit" className={btnPrimary} disabled={phase === "verifying" || !code.trim()} data-testid="admin-step-up-verify">
            {phase === "verifying" ? "Checking…" : "Confirm"}
          </button>
          <button type="button" className={btnSecondary} disabled={phase === "verifying"} onClick={() => void send()}>
            Send a new code
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={phase === "sending"} onClick={() => void send()} data-testid="admin-step-up-send">
            {phase === "sending" ? "Sending…" : "Email me a code"}
          </button>
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {error ? <ErrorNote testId="admin-step-up-error">{error}</ErrorNote> : null}
    </section>
  );
}
