import { getProviders } from "@/server/admin/system-handlers";

// Jev and provider configuration as yes/no, budget use and health (N7, C12 A19). Never a key.
export function GET(request: Request) {
  return getProviders(request);
}
