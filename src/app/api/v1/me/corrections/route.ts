import { listMyCorrections } from "@/server/corrections/handlers";

// The signed-in commuter's own corrections. Never cached.
export function GET(request: Request) {
  return listMyCorrections(request);
}
