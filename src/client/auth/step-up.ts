"use client";

// Browser side of step-up (N3): ask the server to email a fresh code, then send the code back.
// The server records the verification for this session; the browser keeps nothing.
import { stepUpCodeResponseSchema, stepUpVerifyResponseSchema } from "@/domain/auth/step-up";

export type StepUpResult = { ok: true } | { ok: false; reason: "signed_out" | "rate_limited" | "bad_code" | "failed" };

async function post(url: string, body: unknown): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
  } catch {
    return null;
  }
}

function failure(status: number | undefined): StepUpResult {
  if (status === 401) return { ok: false, reason: "signed_out" };
  if (status === 429) return { ok: false, reason: "rate_limited" };
  if (status === 400) return { ok: false, reason: "bad_code" };
  return { ok: false, reason: "failed" };
}

export async function sendStepUpCode(): Promise<StepUpResult> {
  const r = await post("/api/v1/me/step-up/code", {});
  if (r && stepUpCodeResponseSchema.safeParse(r.body).success) return { ok: true };
  return failure(r?.status);
}

export async function verifyStepUpCode(code: string): Promise<StepUpResult> {
  const r = await post("/api/v1/me/step-up", { code: code.trim() });
  if (r && stepUpVerifyResponseSchema.safeParse(r.body).success) return { ok: true };
  return failure(r?.status);
}
