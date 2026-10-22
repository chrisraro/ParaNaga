import { requestStepUpCode } from "@/server/auth/step-up-handlers";

// Step-up: email a fresh one-time code (Neon Auth email OTP) to the signed-in user (N3).
export function POST(request: Request) {
  return requestStepUpCode(request);
}
