import { postUserLookup } from "@/server/admin/system-handlers";

// Find one account by its full email address (N7, C12 A18): admins only, audited, rate-limited.
export function POST(request: Request) {
  return postUserLookup(request);
}
