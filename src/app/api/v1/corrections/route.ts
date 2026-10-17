import { createCorrection } from "@/server/corrections/handlers";

// Create and submit a correction (signed in). Never cached; never alters published transit data.
export function POST(request: Request) {
  return createCorrection(request);
}
