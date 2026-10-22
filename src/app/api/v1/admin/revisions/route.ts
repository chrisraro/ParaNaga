import { getRevisions, postDraft } from "@/server/admin/handlers";

// Revisions (N5a, C8): the list, and a new draft copied from the published revision.
export function GET(request: Request) {
  return getRevisions(request);
}

export function POST(request: Request) {
  return postDraft(request);
}
