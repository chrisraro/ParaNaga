import { getReconciliation, postReconciliation } from "@/server/admin/handlers";

// Reconciliation (N5b, C3 A7): nearby stops to link or keep separate; pin mismatches.
export function GET(request: Request) {
  return getReconciliation(request);
}

export function POST(request: Request) {
  return postReconciliation(request);
}
