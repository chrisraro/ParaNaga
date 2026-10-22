import { getStops } from "@/server/admin/handlers";

// Stops of the open draft (N5b, C3: candidate review, stops and curbs).
export function GET(request: Request) {
  return getStops(request);
}
