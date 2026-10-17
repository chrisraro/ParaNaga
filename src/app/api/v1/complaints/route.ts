import { createComplaint } from "@/server/complaints/handlers";

// Submit a private driver report (signed in). Never cached; never published; never sent to Jev.
export function POST(request: Request) {
  return createComplaint(request);
}
