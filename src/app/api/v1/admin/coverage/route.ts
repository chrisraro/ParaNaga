import { getCoverage } from "@/server/admin/handlers";

// Coverage audit rows of a revision (?revision=<uuid>, default the published one) (N5a, A13).
export function GET(request: Request) {
  return getCoverage(request);
}
