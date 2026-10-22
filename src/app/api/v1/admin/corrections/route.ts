import { getCorrections } from "@/server/admin/review-handlers";

// Corrections review queue (N6, C9 A14).
export function GET(request: Request) {
  return getCorrections(request);
}
