import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseTerminalCodeParam } from "@/domain/api/schemas";
import { DetailLoading } from "@/ui/detail/detail-frame";
import { TerminalDetailScreen } from "@/ui/terminals/terminal-detail";

export const metadata: Metadata = {
  title: "Terminal",
  description: "A Naga City terminal on file: the routes whose plans name it, what is not yet mapped, and its sources.",
};

// See src/app/app/stops/[id]/page.tsx: the code is runtime data, read inside Suspense; the
// terminal comes from GET /api/v1/terminals/:code in the browser (404 → the not-found panel).
export default function TerminalPage({ params }: PageProps<"/app/terminals/[code]">) {
  return (
    <Suspense fallback={<DetailLoading what="terminal" />}>
      <TerminalFromParams params={params} />
    </Suspense>
  );
}

async function TerminalFromParams({ params }: { params: PageProps<"/app/terminals/[code]">["params"] }) {
  const code = parseTerminalCodeParam((await params).code);
  if (!code.ok) notFound();
  return <TerminalDetailScreen code={code.value} />;
}
