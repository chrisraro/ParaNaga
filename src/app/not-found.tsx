import type { Metadata } from "next";
import { NotFoundView } from "./not-found-view";

// Branded 404 for unknown URLs (and notFound() outside /app, which has its own panel).
// Next adds <meta name="robots" content="noindex"> to not-found responses.
export const metadata: Metadata = {
  title: "Page not found",
  description: "There is nothing at this link on Lunad.",
};

export default function NotFound() {
  return <NotFoundView />;
}
