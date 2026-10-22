import { verifyStepUpCode } from "@/server/auth/step-up-handlers";

// Step-up: check the emailed code for this session (N3). Private, never cached; the code is never logged.
export function POST(request: Request) {
  return verifyStepUpCode(request);
}
