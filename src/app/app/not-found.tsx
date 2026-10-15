import { DetailNotFound } from "@/ui/detail/detail-frame";

// Unknown stop id / route code inside /app (malformed ones call notFound() on the server; ids
// that are well formed but unpublished get the same panel from the client).
export default function AppNotFound() {
  return <DetailNotFound />;
}
