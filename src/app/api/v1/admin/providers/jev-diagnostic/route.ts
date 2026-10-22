import { postJevDiagnostic } from "@/server/admin/system-handlers";

// One synthetic Jev Decisions call (N7, C12 A19): admins only, when configured; audited.
export function POST(request: Request) {
  return postJevDiagnostic(request);
}
